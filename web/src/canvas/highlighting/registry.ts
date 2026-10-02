import { goHighlighter } from "./goHighlighter";
import { bashHighlighter } from "./bashHighlighter";
import { cHighlighter } from "./cHighlighter";
import { cppHighlighter } from "./cppHighlighter";
import { csharpHighlighter } from "./csharpHighlighter";
import { cssHighlighter } from "./cssHighlighter";
import { javaHighlighter } from "./javaHighlighter";
import { javascriptHighlighter } from "./javascriptHighlighter";
import { jsonHighlighter } from "./jsonHighlighter";
import { jsxHighlighter } from "./jsxHighlighter";
import { kotlinHighlighter } from "./kotlinHighlighter";
import { markdownHighlighter } from "./markdownHighlighter";
import { plainTextHighlighter } from "./plainTextHighlighter";
import { pythonHighlighter } from "./pythonHighlighter";
import { rubyHighlighter } from "./rubyHighlighter";
import { rustHighlighter } from "./rustHighlighter";
import { sqlHighlighter } from "./sqlHighlighter";
import { swiftHighlighter } from "./swiftHighlighter";
import { tomlHighlighter } from "./tomlHighlighter";
import { tsxHighlighter } from "./tsxHighlighter";
import { typescriptHighlighter } from "./typescriptHighlighter";
import { yamlHighlighter } from "./yamlHighlighter";
import type { LanguageHighlighter } from "./types";

/** Strategy selector, analogous to AnalyzerRegistry.for_file() (src/codechroma/analyzers/registry.py). */
const BY_LANGUAGE: Record<string, LanguageHighlighter> = {
  python: pythonHighlighter,
  py: pythonHighlighter,
  go: goHighlighter,
  golang: goHighlighter,
  java: javaHighlighter,
  yaml: yamlHighlighter,
  yml: yamlHighlighter,
  typescript: typescriptHighlighter,
  ts: typescriptHighlighter,
  javascript: javascriptHighlighter,
  js: javascriptHighlighter,
  node: javascriptHighlighter,
  jsx: jsxHighlighter,
  react: jsxHighlighter,
  tsx: tsxHighlighter,
  c: cHighlighter,
  cpp: cppHighlighter,
  "c++": cppHighlighter,
  cxx: cppHighlighter,
  csharp: csharpHighlighter,
  "c#": csharpHighlighter,
  cs: csharpHighlighter,
  ruby: rubyHighlighter,
  rb: rubyHighlighter,
  rust: rustHighlighter,
  rs: rustHighlighter,
  swift: swiftHighlighter,
  kotlin: kotlinHighlighter,
  kt: kotlinHighlighter,
  json: jsonHighlighter,
  css: cssHighlighter,
  markdown: markdownHighlighter,
  md: markdownHighlighter,
  sql: sqlHighlighter,
  bash: bashHighlighter,
  sh: bashHighlighter,
  shell: bashHighlighter,
  toml: tomlHighlighter,
};

export function getHighlighter(language?: string): LanguageHighlighter {
  return (language && BY_LANGUAGE[language.toLowerCase()]) || plainTextHighlighter;
}
