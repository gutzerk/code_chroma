import type {
  MessageReply,
  RedoRequest,
  ReviewDecision,
  Run,
  RunEvent,
  StopMode,
  WorkflowDef,
} from "../workflows/types";
import type {
  OpenQuestionsPayload,
  QuestionAck,
  QuestionAnswerBody,
} from "../canvas/doc/question/questionAdapter";
import type {
  AgentEvent,
  CanvasBatch,
  CanvasBatchResult,
  CanvasDoc,
  CanvasPing,
  ChangeCardSet,
  Connection,
  DiagramFetchKind,
  DiagramGenerationOptions,
  DiagramGenerationStatus,
  DiagramLayout,
  DiagramsStatus,
  DiagramTypeSummary,
  EpicBriefJobState,
  EpicWorkItem,
  FunctionDiff,
  HierarchyNodeRef,
  LayoutKind,
  Trace,
  TraceStreamMessage,
  TraceSummary,
  WikiGeneralStatus,
} from "../state/types";
import type {
  DiagramEventKind,
  DiagramPayloadFor,
  EngineClient,
  SidecarKind,
  SidecarPayload,
  SkillRunKind,
} from "./EngineClient";

/**
 * Base for an EngineClient that wraps another one and only changes a method or two — every method
 * a subclass doesn't override forwards to `inner` verbatim.
 *
 * The forwarding lives here once instead of being re-typed in each wrapper, and `implements
 * EngineClient` makes the compiler flag a method added to the interface but not forwarded, so a
 * wrapper can never silently expose an incomplete API.
 */
export abstract class DelegatingEngineClient implements EngineClient {
  constructor(protected readonly inner: EngineClient) {}

  getNode(nodeId: string, signal?: AbortSignal): Promise<HierarchyNodeRef | null> {
    return this.inner.getNode(nodeId, signal);
  }
  getChildren(nodeId: string): Promise<HierarchyNodeRef[]> {
    return this.inner.getChildren(nodeId);
  }
  getConnections(nodeId: string): Promise<Connection[]> {
    return this.inner.getConnections(nodeId);
  }
  getRoute(fromId: string, toId: string): Promise<string[] | null> {
    return this.inner.getRoute(fromId, toId);
  }
  getDiff(signal?: AbortSignal): Promise<FunctionDiff[]> {
    return this.inner.getDiff(signal);
  }

  getChangeCards(signal?: AbortSignal): Promise<ChangeCardSet> {
    return this.inner.getChangeCards(signal);
  }
  acceptDiff(nodeId: string): Promise<void> {
    return this.inner.acceptDiff(nodeId);
  }
  subscribe(onChange: () => void): () => void {
    return this.inner.subscribe(onChange);
  }
  getDiagram<K extends DiagramFetchKind>(kind: K): Promise<DiagramPayloadFor<K>> {
    return this.inner.getDiagram(kind);
  }
  getDiagramLayout(kind: LayoutKind): Promise<DiagramLayout> {
    return this.inner.getDiagramLayout(kind);
  }
  saveDiagramLayout(kind: LayoutKind, layout: DiagramLayout): Promise<void> {
    return this.inner.saveDiagramLayout(kind, layout);
  }
  getCanvas(): Promise<CanvasDoc> {
    return this.inner.getCanvas();
  }
  patchCanvas(batch: CanvasBatch): Promise<CanvasBatchResult> {
    return this.inner.patchCanvas(batch);
  }
  subscribeCanvas(onChange: (ping: CanvasPing) => void): () => void {
    return this.inner.subscribeCanvas(onChange);
  }
  runRecipe(recipe: string): Promise<CanvasBatchResult> {
    return this.inner.runRecipe(recipe);
  }

  getOpenQuestions(): Promise<OpenQuestionsPayload> {
    return this.inner.getOpenQuestions();
  }
  answerQuestion(questionId: string, body: QuestionAnswerBody): Promise<QuestionAck> {
    return this.inner.answerQuestion(questionId, body);
  }
  skipQuestion(questionId: string): Promise<QuestionAck> {
    return this.inner.skipQuestion(questionId);
  }
  reviseQuestion(questionId: string): Promise<QuestionAck> {
    return this.inner.reviseQuestion(questionId);
  }

  getDiagramsStatus(): Promise<DiagramsStatus> {
    return this.inner.getDiagramsStatus();
  }
  deleteDiagram(kind: string): Promise<{ deleted: boolean }> {
    return this.inner.deleteDiagram(kind);
  }
  subscribeDiagram(kind: DiagramEventKind, onChange: () => void): () => void {
    return this.inner.subscribeDiagram(kind, onChange);
  }
  generateDiagram(
    kind: SkillRunKind,
    options?: DiagramGenerationOptions,
  ): Promise<DiagramGenerationStatus> {
    return this.inner.generateDiagram(kind, options);
  }
  getDiagramStatus(kind: SkillRunKind): Promise<DiagramGenerationStatus> {
    return this.inner.getDiagramStatus(kind);
  }
  generateProcessDiagram(typeId: string, request: string): Promise<DiagramGenerationStatus> {
    return this.inner.generateProcessDiagram(typeId, request);
  }

  getProcessDiagramStatus(typeId: string): Promise<DiagramGenerationStatus> {
    return this.inner.getProcessDiagramStatus(typeId);
  }

  cancelDiagram(kind: SkillRunKind): Promise<DiagramGenerationStatus> {
    return this.inner.cancelDiagram(kind);
  }
  subscribeDiagramStatus(
    kind: SkillRunKind,
    onChange: (status: DiagramGenerationStatus) => void,
  ): () => void {
    return this.inner.subscribeDiagramStatus(kind, onChange);
  }
  getDiagramOutput(kind: SkillRunKind): Promise<string[]> {
    return this.inner.getDiagramOutput(kind);
  }
  subscribeDiagramOutput(kind: SkillRunKind, onLines: (lines: string[]) => void): () => void {
    return this.inner.subscribeDiagramOutput(kind, onLines);
  }
  getWikiGeneralStatus(): Promise<WikiGeneralStatus> {
    return this.inner.getWikiGeneralStatus();
  }
  updateWikiGeneral(): Promise<DiagramGenerationStatus> {
    return this.inner.updateWikiGeneral();
  }
  getSidecar<K extends SidecarKind>(kind: K): Promise<SidecarPayload[K]> {
    return this.inner.getSidecar(kind);
  }
  subscribeSidecar(kind: SidecarKind, onChange: () => void): () => void {
    return this.inner.subscribeSidecar(kind, onChange);
  }
  listTraces(): Promise<TraceSummary[]> {
    return this.inner.listTraces();
  }
  getTrace(traceId: string): Promise<Trace> {
    return this.inner.getTrace(traceId);
  }
  subscribeTrace(onChange: () => void): () => void {
    return this.inner.subscribeTrace(onChange);
  }
  subscribeTraceStream(onEvent: (message: TraceStreamMessage) => void): () => void {
    return this.inner.subscribeTraceStream(onEvent);
  }
  subscribeAgents(onEvent: (message: AgentEvent) => void): () => void {
    return this.inner.subscribeAgents(onEvent);
  }
  listWorkflows(): Promise<WorkflowDef[]> {
    return this.inner.listWorkflows();
  }
  createWorkflow(workflow: WorkflowDef): Promise<WorkflowDef> {
    return this.inner.createWorkflow(workflow);
  }

  listRuns(): Promise<Run[]> {
    return this.inner.listRuns();
  }
  getRun(runId: string): Promise<Run> {
    return this.inner.getRun(runId);
  }
  startRun(workflowId: string): Promise<Run> {
    return this.inner.startRun(workflowId);
  }
  pauseRun(runId: string): Promise<Run> {
    return this.inner.pauseRun(runId);
  }
  resumeRun(runId: string): Promise<Run> {
    return this.inner.resumeRun(runId);
  }
  stopRun(runId: string, mode: StopMode): Promise<Run> {
    return this.inner.stopRun(runId, mode);
  }
  keepRunning(runId: string): Promise<Run> {
    return this.inner.keepRunning(runId);
  }
  setBreakpoint(runId: string, stepId: string, on: boolean): Promise<Run> {
    return this.inner.setBreakpoint(runId, stepId, on);
  }
  resumeRunFrom(runId: string, stepId: string): Promise<Run> {
    return this.inner.resumeRunFrom(runId, stepId);
  }
  reviewRun(runId: string, decision: ReviewDecision, note?: string): Promise<Run> {
    return this.inner.reviewRun(runId, decision, note);
  }
  sendRunMessage(runId: string, target: string, text: string): Promise<MessageReply> {
    return this.inner.sendRunMessage(runId, target, text);
  }
  redoRun(runId: string, request: RedoRequest): Promise<Run> {
    return this.inner.redoRun(runId, request);
  }
  cancelRedo(runId: string): Promise<Run> {
    return this.inner.cancelRedo(runId);
  }
  subscribeRuns(onEvent: (event: RunEvent | undefined) => void): () => void {
    return this.inner.subscribeRuns(onEvent);
  }
  getEpicsItem(itemId: string, expand?: string): Promise<EpicWorkItem> {
    return this.inner.getEpicsItem(itemId, expand);
  }
  generateEpicBrief(itemId: string, force?: boolean): Promise<EpicBriefJobState> {
    return this.inner.generateEpicBrief(itemId, force);
  }
  getEpicBrief(itemId: string): Promise<EpicBriefJobState> {
    return this.inner.getEpicBrief(itemId);
  }
  getEpicBriefOutput(itemId: string): Promise<string[]> {
    return this.inner.getEpicBriefOutput(itemId);
  }
  cancelEpicBrief(itemId: string): Promise<EpicBriefJobState> {
    return this.inner.cancelEpicBrief(itemId);
  }
  listDiagramTypes(): Promise<DiagramTypeSummary[]> {
    return this.inner.listDiagramTypes();
  }
  dispose(): void {
    this.inner.dispose?.();
  }
}
