import { describe, expect, it } from "vitest";
import { buildViewContext, type ViewContextInput } from "./viewContext";

function base(overrides: Partial<ViewContextInput>): ViewContextInput {
  return { workspace: "main", view: "hierarchy", ...overrides };
}

describe("buildViewContext", () => {
  it("describes the epics AI brief with the epic title and source", () => {
    const input = base({
      view: "epic",
      epics: { focusedId: "EP-A-01", showAiBrief: true } as ViewContextInput["epics"],
      epicTitle: "Alpha foundation",
      epicSource: "plan/epics/EP-A-01.md",
    });

    const result = buildViewContext(input);

    expect(result?.description).toContain('epic "Alpha foundation"');
    expect(result?.description).toContain("AI brief");
    expect(result?.description).toContain("plan/epics/EP-A-01.md");
  });

  it("falls back to the epic id when the title isn't loaded", () => {
    const result = buildViewContext(
      base({
        view: "epic",
        epics: { focusedId: "EP-A-01", showAiBrief: false } as ViewContextInput["epics"],
      }),
    );

    expect(result?.description).toContain("epic (id EP-A-01)");
  });

  it("describes C1 with the system name when present", () => {
    const result = buildViewContext(
      base({ view: "c1", c1System: { name: "CodeChroma", description: "A mapping tool" } }),
    );

    expect(result?.description).toContain('"CodeChroma"');
    expect(result?.description).toContain("A mapping tool");
  });

  it("describes patterns with a count", () => {
    const result = buildViewContext(base({ view: "pattern", patternsCount: 4 }));
    expect(result?.description).toContain("4 patterns");
  });

  it("describes a custom diagram with its title", () => {
    const result = buildViewContext(base({ view: "custom", customTitle: "Data flow" }));
    expect(result?.description).toContain('"Data flow"');
  });

  it("describes the hierarchy with the breadcrumb", () => {
    const result = buildViewContext(base({ breadcrumb: ["src", "web", "App.tsx"] }));
    expect(result?.description).toContain("src › web › App.tsx");
  });

  it("never returns null for a known view", () => {
    for (const view of ["hierarchy", "c1", "pattern", "epic", "custom"] as const) {
      expect(buildViewContext(base({ view }))).not.toBeNull();
    }
  });
});
