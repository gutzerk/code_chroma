import { describe, expect, it } from "vitest";
import { htmlPage } from "./exportFormats";

describe("htmlPage", () => {
  it("embeds the snapshot and escapes the title", () => {
    const page = htmlPage('a <b> "c"', "data:image/svg+xml;charset=utf-8,x", "#000");

    expect(page).toContain('<img src="data:image/svg+xml;charset=utf-8,x"');
    expect(page).toContain("<title>a &lt;b> &quot;c&quot;</title>");
  });
});
