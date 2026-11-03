import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { FileTypeIcon } from "./FileTypeIcon";
import { FILE_TYPE_ICONS } from "./fileTypeIcons.generated";
import { MAPPED_FILE_TYPE_SLUGS, fileTypeFill, fileTypeSlug } from "./fileTypes";

describe("fileTypeSlug", () => {
  it.each([
    ["main.py", "python"],
    ["Block.TSX", "react"],
    ["store.ts", "typescript"],
    ["Program.cs", "dotnet"],
    ["README.md", "markdown"],
    ["Dockerfile", "docker"],
    ["package.json", "npm"],
    ["pyproject.toml", "poetry"],
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

  it.each(["notes.unknown", "Makefile", "r", "LICENSE"])("has no logo for %s", (fileName) => {
    const slug = fileTypeSlug(fileName);

    expect(slug).toBeNull();
  });
});

it("has a generated logo for every slug the tables map to", () => {
  const missing = [...MAPPED_FILE_TYPE_SLUGS].filter((slug) => !(slug in FILE_TYPE_ICONS));

  expect(missing).toEqual([]);
});

describe("fileTypeFill", () => {
  it.each([
    ["3776AB", "#3776AB"],
    ["000000", "#65696d"],
    ["663399", "#7a53a6"],
  ])("lightens brand color %s to %s when needed on the dark panel", (hex, expected) => {
    const fill = fileTypeFill(hex);

    expect(fill).toBe(expected);
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
