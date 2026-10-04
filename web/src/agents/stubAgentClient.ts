import type { GithubOpenPr, PrImportPreflight, PrWorkspace, PrWorkspaceList } from "../state/types";

/** An empty pull-request list — what GET /prs returns when no review is open. */
const EMPTY_PR_LIST: PrWorkspaceList = {
  prs: [],
  max_prs: 3,
  active_workspace: "main",
};

/**
 * Inert defaults for the pull-request slice of AgentClient, for the tests that hand-build one to
 * exercise the agent panel, rail or windows.
 *
 * Spread this into such a stub (`{...PR_CLIENT_STUB, list: …}`) so adding a PR method doesn't mean
 * editing five test files — the same argument stubEngineClient's IMPACT_CHANGES_STUB makes. Blocked
 * rather than ready on purpose: a test that didn't declare a PR fixture must not accidentally pass an
 * assertion about one.
 */
export const PR_CLIENT_STUB = {
  listPrs: async (): Promise<PrWorkspaceList> => EMPTY_PR_LIST,
  listGithubPrs: async (): Promise<GithubOpenPr[]> => [],
  prImportPreflight: async (): Promise<PrImportPreflight> => ({
    ready: false,
    reason: "not-github",
    text: "Could not detect a GitHub repository; check that `gh repo view` works here",
  }),
  openPr: async (): Promise<PrWorkspace> => {
    throw new Error("no bridge in this test");
  },
  refreshPr: async (): Promise<PrWorkspace & { updated: boolean }> => {
    throw new Error("no bridge in this test");
  },
  closePr: async (): Promise<void> => {},
};
