import { openFilesStore } from "../canvas/openFilesStore";
import { projectTreePanelStore } from "../canvas/projectTreePanelStore";
import { inspectorStore } from "../canvas/inspectorStore";
import { expansionStore } from "../state/expansionState";
import { tutorialSimStore } from "./tutorialSim";

export const TUTORIAL_ROOT_NAME = "codechroma-tutorial";

export type TutorialPlacement = "right" | "left" | "bottom" | "center" | "corner";

export const TUTORIAL_STAGES: readonly string[] = [
  "Code tree",
  "Diagrams",
  "Editing",
  "Agents and plans",
  "Pull requests",
];

export interface TutorialStep {
  id: string;
  /** 1-based index into TUTORIAL_STAGES. */
  stage: number;
  text: string;
  /** CSS selector of the one element the user may click; omitted for a chat-only step. */
  target?: string;
  placement: TutorialPlacement;
  /** "click" waits for the user to click the target, "next" shows a button on the chat itself and
   * "auto" waits for a simulation to call `advanceTutorialFrom`. */
  advance: "click" | "next" | "auto";
  nextLabel?: string;
  /** Skips the highlight ring: the target is only the area the user may interact with. */
  quiet?: boolean;
  onEnter?: () => void;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "welcome",
    stage: 1,
    text: "Welcome to CodeChroma! I'm your guide. This is a tiny todo app with a frontend, a backend and a database. We'll explore it step by step, and I'll only let you click what I point at.",
    placement: "center",
    advance: "next",
    nextLabel: "Let's go",
  },
  {
    id: "open-tree",
    stage: 1,
    text: "CodeChroma shows your project as a map, but the real source code is always one click away. This button opens the code tree. Click it.",
    target: ".project-tree-toggle-button",
    placement: "right",
    advance: "click",
    onEnter: () => {
      projectTreePanelStore.reset();
      openFilesStore.reset();
    },
  },
  {
    id: "open-file",
    stage: 1,
    text: "This is the code tree. I opened the backend folder for you. Click service.py to read its real code.",
    target: '[data-node-id="component::backend/service.py"]',
    placement: "right",
    advance: "click",
    onEnter: () => {
      expansionStore.expand("root");
      expansionStore.expand("dir::backend");
    },
  },
  {
    id: "code-opened",
    stage: 1,
    text: "That's the real code of service.py, right next to the map. Every box on the map links back to code like this. More lessons are coming soon.",
    target: ".code-sidebar",
    placement: "right",
    advance: "next",
    nextLabel: "Next stage",
  },
  {
    id: "generate",
    stage: 2,
    text: "Stage 2: diagrams. First, the Generate button. It builds an architecture wiki, an AI-written description of your project. You can draw diagrams without it, but with the wiki they come out faster and better. Click Generate.",
    target: '[data-testid="wiki-general-generate"]',
    placement: "right",
    advance: "click",
    onEnter: () => tutorialSimStore.reset(),
  },
  {
    id: "wiki-building",
    stage: 2,
    text: "The wiki is being built. In the real app an AI agent reads your code and this takes a few minutes. Here it's a quick simulation.",
    placement: "center",
    advance: "auto",
  },
  {
    id: "wiki-ready",
    stage: 2,
    text: "The wiki is ready. This notice tells you when it's done. Click the check mark to dismiss it.",
    target: '[data-testid="wiki-ready-dismiss"]',
    placement: "right",
    advance: "click",
  },
  {
    id: "draw",
    stage: 2,
    text: "Now let's draw a diagram. This button opens a Claude Code agent that draws one for you. Click it.",
    target: '[data-testid="draw-diagram-button"]',
    placement: "right",
    advance: "click",
  },
  {
    id: "choose-diagram",
    stage: 2,
    text: "A real terminal just opened with Claude Code inside. Here Claude is scripted for the lesson. Use the arrow keys to look at the options, then press Enter on the diagram you want.",
    target: '[data-testid="tutorial-agent"]',
    placement: "left",
    advance: "auto",
  },
  {
    id: "agent-building",
    stage: 2,
    text: "Claude is drawing the diagram from the wiki. The real agent takes a minute or two.",
    placement: "corner",
    advance: "auto",
  },
  {
    id: "diagram-shown",
    stage: 2,
    text: "Here is your diagram, drawn from the wiki and placed on the canvas. Every box links back to real code. That completes stage 2.",
    placement: "corner",
    advance: "next",
    nextLabel: "Next stage",
  },
  {
    id: "move-block",
    stage: 3,
    text: "Stage 3: working with a diagram. A diagram is not a picture, you can move its blocks. Drag this block the way the arrow points.",
    target: '[data-recipe-key="fn::add_todo"]',
    placement: "right",
    advance: "auto",
  },
  {
    id: "open-block",
    stage: 3,
    text: "A click on a block shows what is really inside. This block is a whole file, backend/app.py. Click it.",
    target: '[data-recipe-key="infra::handlers"]',
    placement: "right",
    advance: "click",
  },
  {
    id: "inspect-block",
    stage: 3,
    text: "The panel on the right is the real structure of that file: the rows are the functions inside it. Press Show File to read the whole file.",
    target: '.inspector-level-actions .inspector-code-button',
    placement: "left",
    advance: "click",
  },
  {
    id: "inspect-code",
    stage: 3,
    text: "This is the real code of the file. Press Hide File to go back to the list, or click a function in the list to dive into it. Look around, then press Next.",
    target: '[data-testid="inspector-panel"]',
    quiet: true,
    placement: "left",
    advance: "next",
    nextLabel: "Next",
  },
  {
    id: "concept-block",
    stage: 3,
    text: "Not every block is code. SQLite is a concept: it is the database file, so no source file stands behind it. Such blocks are drawn because the picture would be incomplete without them. Click it.",
    target: '[data-recipe-key="ext::sqlite"]',
    placement: "right",
    advance: "click",
    onEnter: () => inspectorStore.close(),
  },
  {
    id: "concept-explained",
    stage: 3,
    text: "A concept block opens a short explanation instead of code. The Facade and Repository frames work the same way. That completes stage 3.",
    target: '[data-testid="description-popup"]',
    quiet: true,
    placement: "left",
    advance: "next",
    nextLabel: "Next stage",
  },
  {
    id: "agents-tab",
    stage: 4,
    text: "Stage 4: agents and plans. Diagrams are drawn by agents, and agents can also change your code. This panel lists them, and the agent that drew your diagram is already there. Open the Agents tab.",
    target: '[data-testid="agent-task-rail-tab-agents"]',
    placement: "left",
    advance: "click",
  },
  {
    id: "open-agent1",
    stage: 4,
    text: "Here is the agent that drew your first diagram. Click it to open its window and talk to it again.",
    target: '[data-testid="agent-rail-tutorial-1"]',
    placement: "left",
    advance: "click",
  },
  {
    id: "pick-feature",
    stage: 4,
    text: "Let's ask it to plan a new feature. Choose one with the arrow keys and press Enter. Claude will not write code yet, only show the plan.",
    target: '[data-testid="tutorial-agent"]',
    quiet: true,
    placement: "left",
    advance: "auto",
    onEnter: () => tutorialSimStore.requestScene("feature"),
  },
  {
    id: "plan-working",
    stage: 4,
    text: "Claude is placing the feature on the diagram.",
    placement: "corner",
    advance: "auto",
  },
  {
    id: "plan-shown",
    stage: 4,
    text: "There it is: the new blocks carry a PLAN · ADD label. That is a plan, they do not exist in the code yet. The arrows show where the feature will plug into the app.",
    target: '[data-recipe-key="plan::service"]',
    placement: "right",
    advance: "next",
    nextLabel: "Next",
  },
  {
    id: "run-agent",
    stage: 4,
    text: "Now let's have a second agent build it. Run agent starts a new one right next to the others. Click it.",
    target: ".agents-toggle-button",
    placement: "bottom",
    advance: "click",
  },
  {
    id: "agent2-started",
    stage: 4,
    text: "The second agent got the plan and started writing the code. It works on its own, so we don't have to wait. Go back to the first agent in the list.",
    target: '[data-testid="agent-rail-tutorial-1"]',
    placement: "left",
    advance: "click",
  },
  {
    id: "second-diagram",
    stage: 4,
    text: "While agent 2 is busy, ask this one for another view of the project. Press Enter to draw the system context diagram.",
    target: '[data-testid="tutorial-agent"]',
    quiet: true,
    placement: "left",
    advance: "auto",
    onEnter: () => tutorialSimStore.requestScene("second"),
  },
  {
    id: "second-working",
    stage: 4,
    text: "Claude is drawing the second diagram.",
    placement: "corner",
    advance: "auto",
  },
  {
    id: "diagrams-tab",
    stage: 4,
    text: "Two diagrams on one canvas can get crowded. The Diagrams tab lets you hide any of them. Open it.",
    target: '[data-testid="agent-task-rail-tab-diagrams"]',
    placement: "left",
    advance: "click",
  },
  {
    id: "hide-diagram",
    stage: 4,
    text: "Click the System context row to hide that diagram from the canvas.",
    target: '[data-testid="diagram-rail-c1"]',
    placement: "left",
    advance: "click",
  },
  {
    id: "show-diagram",
    stage: 4,
    text: "It is hidden, not deleted. Click the row again to bring it back.",
    target: '[data-testid="diagram-rail-c1"]',
    placement: "left",
    advance: "click",
  },
  {
    id: "back-to-agents",
    stage: 4,
    text: "Time to check on agent 2. Go back to the Agents tab.",
    target: '[data-testid="agent-task-rail-tab-agents"]',
    placement: "left",
    advance: "click",
  },
  {
    id: "open-agent2",
    stage: 4,
    text: "Agent 2 is in the list. Click it to see its window.",
    target: '[data-testid="agent-rail-tutorial-2"]',
    placement: "left",
    advance: "click",
  },
  {
    id: "agent2-result",
    stage: 4,
    text: "Agent 2 is writing the code. As soon as it finishes, watch the PLAN label on the new blocks.",
    target: '[data-testid="tutorial-agent-2"]',
    quiet: true,
    placement: "left",
    advance: "auto",
  },
  {
    id: "plan-built",
    stage: 4,
    text: "Done. The PLAN label is gone: the blocks are now linked to the real code that agent 2 wrote. A plan turns into code, and the diagram keeps up. That completes stage 4.",
    target: '[data-recipe-key="plan::service"]',
    placement: "right",
    advance: "next",
    nextLabel: "Next stage",
  },
  {
    id: "gh-cli",
    stage: 5,
    text: "Stage 5: reviewing a pull request. CodeChroma talks to GitHub through the GitHub CLI, so you need it first: install gh from cli.github.com and run gh auth login once. The canvas is empty again, no agents and no diagrams. Is gh ready?",
    placement: "center",
    advance: "next",
    nextLabel: "gh is ready",
  },
  {
    id: "pr-button",
    stage: 5,
    text: "This is the pull request button. Click it.",
    target: '[data-testid="pr-toggle-button"]',
    placement: "bottom",
    advance: "click",
  },
  {
    id: "pr-pick",
    stage: 5,
    text: "Your repository has one open pull request. Pick it in the list.",
    target: '[data-testid="pr-dialog-select"]',
    placement: "left",
    advance: "auto",
  },
  {
    id: "pr-impact",
    stage: 5,
    text: "Tick this box to build the impact diagram right away: you get a picture of what the pull request changes without asking for it.",
    target: '[data-testid="pr-dialog-impact"]',
    placement: "left",
    advance: "auto",
  },
  {
    id: "pr-open",
    stage: 5,
    text: "Open it on the canvas.",
    target: '[data-testid="pr-dialog-open"]',
    placement: "left",
    advance: "click",
  },
  {
    id: "impact-working",
    stage: 5,
    text: "Drawing the impact diagram of the pull request.",
    placement: "corner",
    advance: "auto",
  },
  {
    id: "impact-shown",
    stage: 5,
    text: "Here is what the pull request changes. ADD marks new code and MODIFY marks changed code. The boxes without a label are untouched code that the change talks to.",
    target: '[data-testid="impact-status-chip"]',
    placement: "right",
    advance: "next",
    nextLabel: "Next",
  },
  {
    id: "run-agent-pr",
    stage: 5,
    text: "Now ask an agent about this pull request. Click Run agent.",
    target: ".agents-toggle-button",
    placement: "bottom",
    advance: "click",
  },
  {
    id: "explain-working",
    stage: 5,
    text: "The agent explains add_todo and will break its block into steps. Watch the diagram.",
    target: '[data-testid="tutorial-agent-2"]',
    quiet: true,
    placement: "left",
    advance: "auto",
  },
  {
    id: "split-done",
    stage: 5,
    text: "The agent split add_todo into three blocks and numbered them STEP 1 to 3. Ask about any block and the diagram gets as detailed as you need. That is the end of the tutorial.",
    target: '[data-testid="canvas-node-order-badge"]',
    placement: "right",
    advance: "next",
    nextLabel: "Finish",
  },
];
