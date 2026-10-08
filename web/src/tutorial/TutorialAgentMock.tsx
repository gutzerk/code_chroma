import { useEffect, useRef, useState } from "react";
import { AgentTerminal } from "../agents/AgentTerminal";
import { collectActiveLayers, useCanvasDoc } from "../canvas/doc/canvasDocStore";
import { removeLayerAndRefresh, runRecipeAndLayout } from "../canvas/doc/diagramCatalog";
import { seedLayerPositions } from "../canvas/doc/layerPositionCache";
import { useEngineClient } from "../engine-client/EngineClientContext";
import runAgentIcon from "../icons/run-agent.svg";
import { TerminalClientProvider } from "../terminal/TerminalClientContext";
import { createDrawDiagramClient, createImpactClient } from "./drawDiagramScript";
import { IMPACT_DIAGRAM_TASK } from "../pr/PrDialog";
import { explainScene } from "./explainScript";
import { createImplementClient } from "./implementScript";
import type { Scene, ScriptedClient } from "./scriptedSession";
import { splitAddTodo } from "./tutorialSplit";
import { buildPlan, drawPlan, featureById, TUTORIAL_FEATURES } from "./tutorialPlan";
import { applyStageState } from "./tutorialStageState";
import { tutorialSimStore, useTutorialSim } from "./tutorialSim";
import { TUTORIAL_LAYOUTS } from "./tutorialLayouts";
import { TutorialMoveArrow } from "./TutorialMoveArrow";
import { TUTORIAL_STEPS } from "./tutorialSteps";
import { advanceTutorialFrom, useTutorialStep } from "./tutorialStore";

const DIAGRAM_LAYERS = ["c1", "patterns", "impact"];
const DIAGRAM_HIDDEN_UNTIL = TUTORIAL_STEPS.findIndex((step) => step.id === "choose-diagram");
const RAIL_GAP = 16;
const DEFAULT_RIGHT = 24;

interface Session {
  id: number;
  client: ScriptedClient;
}

/** In stage 4 the first agent moves to the left of the diagram, leaving the right side to the new one. */
const AGENT_LEFT = 24;

/** How far from the right edge a floating agent window must sit to stay clear of the agents panel. */
function useRightOffset(): number {
  const [offset, setOffset] = useState(DEFAULT_RIGHT);
  useEffect(() => {
    const measure = () => {
      const rail = document.querySelector(".agent-task-rail");
      const rect = rail && !rail.hasAttribute("hidden") ? rail.getBoundingClientRect() : null;
      const next = rect && rect.width > 0 ? window.innerWidth - rect.left + RAIL_GAP : DEFAULT_RIGHT;
      setOffset((previous) => (previous === next ? previous : next));
    };
    measure();
    const timer = window.setInterval(measure, 250);
    return () => window.clearInterval(timer);
  }, []);
  return offset;
}

function AgentWindowShell({
  testId,
  title,
  session,
  open,
  right,
  left,
}: {
  testId: string;
  title: string;
  session: Session | null;
  open: boolean;
  right: number;
  /** When set the window docks to the left edge instead, clear of the one on the right. */
  left?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const sessionId = session?.id;
  useEffect(() => {
    if (!open || sessionId === undefined) return;
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, sessionId]);
  // Kept mounted (just hidden) once a run finishes: tearing an xterm down right after its last
  // write races xterm's own scroll-sync frame and throws an uncaught error.
  if (!session) return null;
  return (
    <div
      className="agent-window tutorial-agent"
      data-testid={testId}
      ref={panelRef}
      style={open ? (left === undefined ? { right } : { left, right: "auto" }) : { display: "none" }}
    >
      <div className="agent-window-title">
        <img className="agent-window-icon" src={runAgentIcon} alt="" aria-hidden="true" />
        <span className="agent-window-name">{title}</span>
      </div>
      <div className="tutorial-agent-terminal">
        <TerminalClientProvider client={session.client} key={session.id}>
          <AgentTerminal workspace="tutorial" running kind="claude" hidden={!open} />
        </TerminalClientProvider>
      </div>
    </div>
  );
}

/** The tutorial's two agent windows: real xterm terminals fed by scripted `claude` sessions. */
export function TutorialAgentMock() {
  const engineClient = useEngineClient();
  const sim = useTutorialSim();
  const right = useRightOffset();
  const nextId = useRef(0);
  const [first, setFirst] = useState<Session | null>(null);
  const [second, setSecond] = useState<Session | null>(null);
  const step = useTutorialStep();
  const stepIndex = step ? TUTORIAL_STEPS.indexOf(step) : -1;

  // The diagram lives in the server-side canvas document, so a leftover from an earlier run must be
  // taken off the canvas until the lesson "draws" it.
  const doc = useCanvasDoc();
  const removingRef = useRef(false);
  useEffect(() => {
    if (!step || stepIndex > DIAGRAM_HIDDEN_UNTIL) return;
    const placed = collectActiveLayers(doc);
    const leftover = DIAGRAM_LAYERS.filter((layer) => placed.has(layer));
    if (removingRef.current || leftover.length === 0) return;
    removingRef.current = true;
    void Promise.all(leftover.map((layer) => removeLayerAndRefresh(engineClient, layer))).finally(
      () => {
        removingRef.current = false;
      },
    );
  }, [step, stepIndex, doc, engineClient]);

  // Entering a stage (by playing on or by jumping on the progress bar) resets the whole scene to
  // what that stage starts with, agents' terminals included.
  const stepId = step?.id ?? null;
  const stage = step?.stage ?? null;
  useEffect(() => {
    if (!step || stage === null) return;
    const firstOfStage = TUTORIAL_STEPS.find((candidate) => candidate.stage === stage);
    if (step !== firstOfStage) return;
    setFirst(null);
    setSecond(null);
    void applyStageState(stage, engineClient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  const drawFirstDiagram = (recipe: string) => {
    tutorialSimStore.reveal(recipe);
    const saved = TUTORIAL_LAYOUTS[recipe];
    if (saved) seedLayerPositions(recipe, saved);
    tutorialSimStore.listAgent1();
    void runRecipeAndLayout(engineClient, recipe)
      .catch(() => undefined)
      .then(() => {
        tutorialSimStore.closeAgent();
        advanceTutorialFrom("agent-building");
        window.setTimeout(tutorialSimStore.fitCanvas, 300);
      });
  };

  const drawImpact = () => {
    tutorialSimStore.reveal("impact");
    seedLayerPositions("impact", TUTORIAL_LAYOUTS.impact);
    tutorialSimStore.listAgent1();
    void runRecipeAndLayout(engineClient, "impact")
      .catch(() => undefined)
      .then(() => {
        tutorialSimStore.closeAgent();
        advanceTutorialFrom("impact-working");
        window.setTimeout(tutorialSimStore.fitCanvas, 300);
      });
  };

  useEffect(() => {
    if (sim.agent !== "open" || first) return;
    nextId.current += 1;
    if (stage === 5) {
      setFirst({ id: nextId.current, client: createImpactClient(IMPACT_DIAGRAM_TASK, drawImpact) });
      return;
    }
    const resumed = (step?.stage ?? 0) >= 4;
    const client = createDrawDiagramClient(
      {
        onChosen: () => advanceTutorialFrom("choose-diagram"),
        onDone: drawFirstDiagram,
      },
      resumed,
    );
    setFirst({ id: nextId.current, client });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim.agent, first]);

  const featureScene = (): Scene => ({
    prompt: "I want to add a new feature to the todo app",
    intro: "I'll plan it on the diagram first. Nothing is built yet.",
    question: "Which feature should I plan?",
    options: TUTORIAL_FEATURES.map((feature) => feature.label),
    workLines: [
      "Reading the design patterns diagram…",
      "Finding the service and storage layers…",
      "Drawing the new blocks as a plan…",
    ],
    ack: (choice) => `${TUTORIAL_FEATURES[choice].label} it is.`,
    doneLine: () => "Planned. The new blocks on your canvas are marked PLAN and not built yet.",
    onChosen: (choice) => {
      tutorialSimStore.setFeature(TUTORIAL_FEATURES[choice].id);
      advanceTutorialFrom("pick-feature");
    },
    onDone: (choice) => {
      void drawPlan(engineClient, TUTORIAL_FEATURES[choice])
        .catch(() => undefined)
        .then(() => {
          tutorialSimStore.closeAgent();
          advanceTutorialFrom("plan-working");
        });
    },
  });

  const secondDiagramScene = (): Scene => ({
    prompt: "Now draw the system context diagram too",
    intro: "I will use the codechroma-draw-diagram skill again.",
    question: "Which diagram would you like?",
    options: ["System context (C1)"],
    workLines: [
      "Reading the architecture wiki…",
      "Finding the people and systems around the app…",
      "Drawing boxes and arrows…",
    ],
    ack: () => "System context (C1) it is.",
    doneLine: () => "Done. The System context diagram is on your canvas.",
    onChosen: () => advanceTutorialFrom("second-diagram"),
    onDone: () => {
      tutorialSimStore.reveal("c1");
      void runRecipeAndLayout(engineClient, "c1")
        .catch(() => undefined)
        .then(() => {
          tutorialSimStore.closeAgent();
          advanceTutorialFrom("second-working");
          window.setTimeout(tutorialSimStore.fitCanvas, 300);
        });
    },
  });

  const explainPrScene = (): Scene =>
    explainScene(() => {
      void splitAddTodo(engineClient)
        .catch(() => undefined)
        .then(() => {
          tutorialSimStore.closeAgent();
          advanceTutorialFrom("explain-working");
        });
    });

  useEffect(() => {
    if (!sim.scene || !first) return;
    const scenes = { feature: featureScene, second: secondDiagramScene, explain: explainPrScene };
    first.client.play(scenes[sim.scene]());
    tutorialSimStore.requestScene(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim.scene, first]);

  const featureId = sim.feature;
  useEffect(() => {
    if (sim.agent2 !== "working" || second) return;
    const feature = featureById(featureId);
    if (!feature) return;
    nextId.current += 1;
    setSecond({
      id: nextId.current,
      client: createImplementClient(feature, {
        onStarted: () => advanceTutorialFrom("send-implement"),
        onDone: tutorialSimStore.finishAgent2,
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim.agent2, second, featureId]);

  // A pull request opened with the impact box ticked starts an agent that draws its impact diagram.
  const impactStarted = useRef(false);
  useEffect(() => {
    if (sim.pr === "none") {
      impactStarted.current = false;
      return;
    }
    if (!sim.prImpact || impactStarted.current) return;
    impactStarted.current = true;
    setFirst(null);
    tutorialSimStore.openAgent();
  }, [sim.pr, sim.prImpact]);

  // The second agent stops half way and carries on only once the user is back in its window.
  useEffect(() => {
    if (stepId === "agent2-result") second?.client.resume();
  }, [stepId, second]);

  // Once the second agent has finished, its planned blocks become real code.
  useEffect(() => {
    if (stepId !== "agent2-result" || sim.agent2 !== "done") return;
    const feature = featureById(featureId);
    if (!feature) return;
    void buildPlan(engineClient, feature)
      .catch(() => undefined)
      .then(() => advanceTutorialFrom("agent2-result"));
  }, [stepId, sim.agent2, featureId, engineClient]);

  return (
    <>
      <TutorialMoveArrow />
      <AgentWindowShell
        testId="tutorial-agent"
        title="Agent · claude"
        session={first}
        open={sim.agent === "open"}
        right={right}
        left={stage === 4 ? AGENT_LEFT : undefined}
      />
      <AgentWindowShell
        testId="tutorial-agent-2"
        title="Agent 2 · claude"
        session={second}
        open={sim.agent2Window}
        right={right}
      />
    </>
  );
}
