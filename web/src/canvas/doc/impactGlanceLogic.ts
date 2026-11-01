import type { CanvasDoc, ImpactBlockChange, ImpactChanges } from "../../state/types";

/** The one-line "before → after" for a touched box, or null when the review wrote neither side. */
export function beforeAfterLine(change: ImpactBlockChange): string | null {
  const before = change.before?.trim();
  const after = change.after?.trim();
  if (before && after) return `${before} → ${after}`;
  return after || before || null;
}

const callerCountCache = new WeakMap<CanvasDoc["edges"], Map<string, number>>();

/** Distinct callers per element id, built in one pass per edges object and shared by every box. */
export function callerCountsOf(doc: CanvasDoc): Map<string, number> {
  const cached = callerCountCache.get(doc.edges);
  if (cached) return cached;
  const callers = new Map<string, Set<string>>();
  for (const edge of Object.values(doc.edges)) {
    if (edge.from === edge.to) continue;
    const set = callers.get(edge.to) ?? new Set<string>();
    set.add(edge.from);
    callers.set(edge.to, set);
  }
  const counts = new Map([...callers].map(([id, set]) => [id, set.size] as const));
  callerCountCache.set(doc.edges, counts);
  return counts;
}

const TEST_PATH = /(^|[/\\])(tests?|__tests__|spec|e2e)([/\\]|$)|[._-](test|spec)s?\.[a-z0-9]+$|(^|[/\\])test_[^/\\]*$|Tests?\.[a-z]+$/i;

/** True for a test file, by the usual directory and file-name conventions. */
export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}

export interface ChangeSize {
  add: number;
  del: number;
  testAdd: number;
  testDel: number;
  /** False when no file carried line counts, so the bar and numbers stay hidden rather than read 0. */
  known: boolean;
  testKnown: boolean;
}

/** Line totals for a box, source and test files apart; a file attributed through several cards counts once. */
export function changeSizeOf(change: ImpactBlockChange): ChangeSize {
  const size: ChangeSize = { add: 0, del: 0, testAdd: 0, testDel: 0, known: false, testKnown: false };
  const seen = new Set<string>();
  for (const file of change.files) {
    if (seen.has(file.path) || file.additions === undefined || file.deletions === undefined) continue;
    seen.add(file.path);
    if (isTestPath(file.path)) {
      size.testAdd += file.additions;
      size.testDel += file.deletions;
      size.testKnown = true;
    } else {
      size.add += file.additions;
      size.del += file.deletions;
      size.known = true;
    }
  }
  return size;
}

export const SIZE_BAR_WIDTH = 60;

/** Pixel widths of the green and red halves of the 60px size bar, proportional to +/- lines. */
export function barWidths(add: number, del: number): { add: number; del: number } {
  const total = add + del;
  if (total === 0) return { add: 0, del: 0 };
  const addPx = Math.round((SIZE_BAR_WIDTH * add) / total);
  return { add: addPx, del: SIZE_BAR_WIDTH - addPx };
}

export interface ImpactSummary {
  modified: number;
  added: number;
  deleted: number;
  tests: number;
  /** The block id of the largest change, when more than one box changed. */
  biggest: string | null;
  /** Blocks small enough to fold into a pill when the change is wide. */
  minor: ReadonlySet<string>;
}

/** Changed boxes above this count fold their smallest members into pills. */
export const MINOR_THRESHOLD = 6;
const MINOR_LINES = 6;

const summaryCache = new WeakMap<ImpactChanges, ImpactSummary>();

/** The header-strip counts plus the biggest-change and minor-box picks, cached per snapshot. */
export function summarizeImpact(changes: ImpactChanges): ImpactSummary {
  const cached = summaryCache.get(changes);
  if (cached) return cached;
  const tests = new Set<string>();
  for (const file of [...changes.unassigned, ...changes.blocks.flatMap((block) => block.files)]) {
    if (isTestPath(file.path)) tests.add(file.path);
  }
  const sized = changes.blocks.map((block) => {
    const size = changeSizeOf(block);
    return { block, lines: size.add + size.del, known: size.known };
  });
  const top = sized.reduce<(typeof sized)[number] | null>(
    (best, entry) => (entry.known && entry.block.status !== "removed" && (!best || entry.lines > best.lines) ? entry : best),
    null,
  );
  const minor = new Set<string>();
  if (changes.blocks.length > MINOR_THRESHOLD) {
    for (const { block, lines, known } of sized) {
      if (known && lines <= MINOR_LINES && block.status === "modified" && block.pr_comments.length === 0) {
        minor.add(block.block);
      }
    }
  }
  const summary: ImpactSummary = {
    modified: changes.blocks.filter((block) => block.status === "modified").length,
    added: changes.blocks.filter((block) => block.status === "added").length,
    deleted: changes.blocks.filter((block) => block.status === "removed").length,
    tests: tests.size,
    biggest: changes.blocks.length > 1 && top && top.lines > 0 ? top.block.block : null,
    minor,
  };
  summaryCache.set(changes, summary);
  return summary;
}

export type ImpactBoxKind = "add" | "modify" | "delete";

/** Which board chip a box wears, from its authored status first and the git status second. */
export function boxKindOf(authored: string | undefined, change: ImpactBlockChange | undefined): ImpactBoxKind | null {
  if (authored === "deleted" || change?.status === "removed") return "delete";
  if (authored === "new" || change?.status === "added") return "add";
  if (authored === "modified" || change?.status === "modified") return "modify";
  return null;
}

export type CollapseKind = "unchanged" | "minor";

/** Whether a box folds into a pill: unchanged context boxes, and small edits when many boxes changed. */
export function collapseKindOf(args: {
  authored: string | undefined;
  change: ImpactBlockChange | undefined;
  summary: ImpactSummary;
  hasChanges: boolean;
  isHeroEnd: boolean;
}): CollapseKind | null {
  const { authored, change, summary, hasChanges, isHeroEnd } = args;
  if (!hasChanges || isHeroEnd) return null;
  if (!change) return !authored || authored === "context" ? "unchanged" : null;
  return summary.minor.has(change.block) && change.block !== summary.biggest ? "minor" : null;
}

/** The "+N −M" and "· test +A −B" figures as display strings. */
export function sizeLabels(size: ChangeSize): { main: string | null; test: string | null } {
  return {
    main: size.known ? `+${size.add} −${size.del}` : null,
    test: size.testKnown ? `· test +${size.testAdd} −${size.testDel}` : null,
  };
}

/** The first sentence of the review summary, trimmed to a one-line title. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const end = trimmed.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? trimmed : trimmed.slice(0, end + 1);
  return sentence.length > 120 ? `${sentence.slice(0, 117)}...` : sentence;
}
