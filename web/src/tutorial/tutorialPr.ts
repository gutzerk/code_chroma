import type { AgentClient } from "../agents/agentClient";
import type { GithubOpenPr } from "../state/types";
import { tutorialSimStore } from "./tutorialSim";

/** The slice of the agent client the pull-request dialog talks to. */
export type PrDialogClient = Pick<
  AgentClient,
  | "prImportPreflight"
  | "listGithubPrs"
  | "listPrs"
  | "openPr"
  | "activateWorkspace"
  | "refreshPr"
  | "closePr"
>;

const TUTORIAL_PR: GithubOpenPr = {
  number: 7,
  title: "Reject empty todo titles",
  head_ref: "feature/validate-title",
  author: "you",
};

const unavailable = () =>
  Promise.reject(new Error("The tutorial never imports a real pull request"));

/** The dialog's stand-in while the tutorial runs: GitHub is not involved, there is one open PR. */
export const tutorialPrClient: PrDialogClient = {
  prImportPreflight: async () => ({ ready: true, reason: null }),
  listGithubPrs: async () => [TUTORIAL_PR],
  listPrs: async () => ({ prs: [], max_prs: 3, active_workspace: "main" }),
  openPr: unavailable,
  activateWorkspace: unavailable,
  refreshPr: unavailable,
  closePr: unavailable,
};

/** "Open on canvas" in the tutorial: closes the dialog and lets the lesson draw what was ticked. */
export function finishTutorialPrOpen(buildImpact: boolean, dismiss: () => void): void {
  dismiss();
  tutorialSimStore.openPr(buildImpact);
}
