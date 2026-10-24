import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLayoutState } from "../canvas/layout/layoutStore";
import { useCanvasDoc } from "../canvas/doc/canvasDocStore";
import { ConnectedQuestionCard } from "../canvas/doc/question/ConnectedQuestionCard";
import { pickQuestionLayout } from "../canvas/doc/question/pickQuestionLayout";
import { resolveSelection, toQuestionView } from "../canvas/doc/question/questionAdapter";
import { QuestionDiagram } from "../canvas/doc/question/QuestionDiagram";
import { useOpenAgentQuestions } from "../canvas/doc/question/useOpenAgentQuestions";

/** Wraps an agent's terminal and shows its oldest open question beside it in the layout that fits the host. */
export function AgentQuestionHost({
  agentId,
  onFocusTerminal,
  children,
}: {
  agentId: string;
  onFocusTerminal: () => void;
  /** The terminal element; it stays at the same position in the tree so a layout switch never remounts xterm. */
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [pick, setPick] = useState<{ questionId: string; optionId: string } | null>(null);
  const { agentsMode } = useLayoutState();
  const doc = useCanvasDoc();
  const current = useOpenAgentQuestions(agentId)[0];
  const question = useMemo(() => (current ? toQuestionView(current) : null), [current]);
  const selectedId = question
    ? resolveSelection(question, pick?.questionId === question.questionId ? pick.optionId : null)
    : null;
  const setSelectedId = (optionId: string) => question && setPick({ questionId: question.questionId, optionId });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const focusCard = useCallback(() => {
    hostRef.current?.querySelector<HTMLElement>('[data-testid="question-card"]')?.focus();
  }, []);

  const onKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const inTerminal = event.target instanceof Element && event.target.closest(".agent-window-terminal");
    if (question && inTerminal && event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      focusCard();
    }
  };

  const hasDiagram = question?.options.some((o) => o.diagramRef) ?? false;
  const layout = question
    ? pickQuestionLayout({ width, full: agentsMode === "full", hasDiagram })
    : "A2";
  const showDiagram = question && hasDiagram && layout !== "A2";
  const diagram = question && showDiagram && (
    <QuestionDiagram
      doc={doc}
      options={question.options}
      selectedId={selectedId}
      onSelect={setSelectedId}
      variant={layout === "B1" ? "box" : "pane"}
    />
  );

  return (
    <div
      ref={hostRef}
      className="agent-question-host"
      data-layout={layout}
      data-testid={`agent-question-host-${agentId}`}
      onKeyDownCapture={onKeyDownCapture}
    >
      {layout === "A4" && diagram}
      {children}
      {current && question && (
        <div className="aq-card" data-testid={`agent-question-${agentId}`} role="region" aria-label="Agent question">
          <ConnectedQuestionCard
            key={current.id}
            question={question}
            variant={layout === "B1" ? "full" : "compact"}
            selectedId={selectedId}
            onSelectedIdChange={setSelectedId}
            onReturnFocus={onFocusTerminal}
          />
          {layout === "B1" && diagram}
        </div>
      )}
    </div>
  );
}
