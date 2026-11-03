import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { contrastRatio } from "./contrast";
import { FileTypeIcon } from "./FileTypeIcon";
import { FILE_TYPE_ICONS } from "./fileTypeIcons.generated";
import {
  ACTIVE_ROW_BACKGROUND,
  MAPPED_FILE_TYPE_SLUGS,
  PANEL_BACKGROUND,
  fileTypeFill,
  fileTypeSlug,
} from "./fileTypes";

describe("fileTypeSlug", () => {
  it.each([
    ["main.py", "python"],
    ["Block.TSX", "react"],
    ["store.ts", "typescript"],
    ["Program.cs", "dotnet"],
    ["README.md", "markdown"],
    ["Dockerfile", "docker"],
    ["package.json", "npm"],
    ["pyproject.toml", "python"],
    ["poetry.lock", "poetry"],
    ["Dockerfile.dev", "docker"],
    [".env", "dotenv"],
    [".gitignore", "git"],
    [".env.local", "dotenv"],
    [".eslintrc", "eslint"],
    [".prettierrc.json", "prettier"],
    ["vite.config.ts", "vite"],
    ["config.json", "json"],
  ])("maps %s to %s", (fileName, expected) => {
    const slug = fileTypeSlug(fileName);

    expect(slug).toBe(expected);
  });

  it.each(["notes.unknown", "Makefile", "r", "LICENSE", "schema.sql", ".envrc"])("has no logo for %s", (fileName) => {
    const slug = fileTypeSlug(fileName);

    expect(slug).toBeNull();
  });
});

it("has a generated logo for every slug the tables map to", () => {
  const missing = [...MAPPED_FILE_TYPE_SLUGS].filter((slug) => !(slug in FILE_TYPE_ICONS));

  expect(missing).toEqual([]);
});

describe("fileTypeFill", () => {
  it("keeps a brand color that is already legible on both row backgrounds", () => {
    const fill = fileTypeFill("F7DF1E");

    expect(fill).toBe("#F7DF1E");
  });

  it.each([
    ["panel", PANEL_BACKGROUND],
    ["open-file row", ACTIVE_ROW_BACKGROUND],
  ])("gives every logo at least 3:1 contrast on the %s background", (_label, background) => {
    const faint = Object.entries(FILE_TYPE_ICONS)
      .filter(([, entry]) => contrastRatio(fileTypeFill(entry.hex), background) < 3)
      .map(([slug]) => slug);

    expect(faint).toEqual([]);
  });

  it.each([
    ["--bg-panel", PANEL_BACKGROUND],
    ["--accent-bg", ACTIVE_ROW_BACKGROUND],
  ])("matches %s in styles.css", (token, copy) => {
    const css = readFileSync(resolve(__dirname, "../styles.css"), "utf-8");

    const value = css.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];

    expect(value?.toLowerCase()).toBe(copy);
  });
});

describe("FileTypeIcon", () => {
  it("renders the language logo for a known file type", () => {
    const { container } = render(<FileTypeIcon fileName="main.py" />);

    expect(container.querySelector("[data-file-type='python']")).not.toBeNull();
  });

  it("falls back to the generic file glyph for an unknown type", () => {
    const { container } = render(<FileTypeIcon fileName="notes.unknown" />);

    expect(container.querySelector(".node-icon-file")).not.toBeNull();
  });
});
