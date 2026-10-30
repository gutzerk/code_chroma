import type { CanvasElement } from "../../../state/types";

/** The one place that maps 017's wire shapes (element `meta`, route payloads) to the UI's view
 * model -- adjust here if the backend's field names differ. */

export type QuestionState = "open" | "answered" | "skipped";

export interface QuestionOption {
  id: string;
  title: string;
  description: string;
  pro: string;
  con: string;
  rank: number | null;
  why: string;
  diagramRef: string | null;
}

export interface QuestionView {
  /** Id the answer/skip/revise routes take: `meta.question_id`, else the element id. */
  questionId: string;
  elementId: string;
  title: string;
  state: QuestionState;
  answer: string | null;
  sessionId: string | null;
  /** The agent that asked, or null when the element carries no `agent_id`. */
  agentId: string | null;
  step: number | null;
  total: number | null;
  options: QuestionOption[];
  allowCustom: boolean;
  allowSkip: boolean;
  /** The user pressed "Add diagram" and the agent has not answered yet. */
  diagramRequested: boolean;
  /** How many times "Add diagram" was pressed; the button is offered at most twice. */
  diagramRequests: number;
}

/** Body of POST /repos/{id}/questions/{qid}/answer. */
export interface QuestionAnswerBody {
  answer: string;
  option_id: string | null;
}

/** Response of the answer/skip/revise routes (and each row of GET /questions' `questions`). */
export interface QuestionAck {
  question_id: string;
  state: QuestionState;
  /** True while an agent call is still blocked on this question. */
  waiting?: boolean;
  answer?: string | null;
}

/** GET /repos/{id}/questions -- the open questions. */
export interface OpenQuestionsPayload {
  questions: QuestionAck[];
}

export const EMPTY_OPEN_QUESTIONS: OpenQuestionsPayload = { questions: [] };

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function toOption(raw: unknown, index: number): QuestionOption | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = str(o.title);
  if (!title) return null;
  return {
    id: str(o.id) || `opt-${index}`,
    title,
    description: str(o.description),
    pro: str(o.pro),
    con: str(o.con),
    rank: num(o.rank),
    why: str(o.why),
    diagramRef: str(o.diagram_ref) || null,
  };
}

function toState(value: unknown): QuestionState {
  return value === "answered" || value === "skipped" ? value : "open";
}

/** The agent that asked a `question` element, or null for any other element or a question with no agent. */
export function questionAgentId(element: CanvasElement): string | null {
  return element.render === "question" ? str(element.meta.agent_id).trim() || null : null;
}

/** Maps a `question` canvas element to the view model; tolerant of a partial meta. */
export function toQuestionView(element: CanvasElement): QuestionView {
  const meta = element.meta;
  const options = Array.isArray(meta.options)
    ? meta.options.map(toOption).filter((o): o is QuestionOption => o !== null)
    : [];
  return {
    questionId: str(meta.question_id) || element.id,
    elementId: element.id,
    title: element.label,
    state: toState(meta.state),
    answer: typeof meta.answer === "string" ? meta.answer : null,
    sessionId: str(meta.session_id) || null,
    agentId: questionAgentId(element),
    step: num(meta.step),
    total: num(meta.total),
    options,
    allowCustom: meta.allow_custom !== false,
    allowSkip: meta.allow_skip !== false,
    diagramRequested: meta.diagram_requested === true,
    diagramRequests: num(meta.diagram_requests) ?? 0,
  };
}

/** Answered/skipped questions of the same session as `current`, ordered by step -- the history. */
export function sessionHistory(
  elements: Record<string, CanvasElement>,
  current: QuestionView,
): QuestionView[] {
  if (!current.sessionId) return [];
  return Object.values(elements)
    .filter((el) => el.render === "question" && el.id !== current.elementId)
    .map(toQuestionView)
    .filter((q) => q.sessionId === current.sessionId && q.state !== "open")
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
}

export type RankTier = "best" | "middle" | "last";

/** Colour tier for an option's AI rank: lowest rank is best, the highest (of 2+ ranked) is last. */
export function rankTier(option: QuestionOption, options: QuestionOption[]): RankTier | null {
  if (option.rank === null) return null;
  const ranks = options.map((o) => o.rank).filter((r): r is number => r !== null);
  if (option.rank === Math.min(...ranks)) return "best";
  if (ranks.length > 1 && option.rank === Math.max(...ranks)) return "last";
  return "middle";
}

/** The recommended (rank-1) option's id, or null when nothing is ranked. */
function preselectedOptionId(question: QuestionView): string | null {
  return question.options.find((o) => rankTier(o, question.options) === "best")?.id ?? null;
}

/** The picked option when it still exists in the question, else the recommended one (a re-ask can replace the options). */
export function resolveSelection(question: QuestionView, pickedId: string | null): string | null {
  return pickedId !== null && question.options.some((o) => o.id === pickedId) ? pickedId : preselectedOptionId(question);
}
