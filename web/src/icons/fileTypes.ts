import { contrastRatio, rgbChannels, rgbHex } from "./contrast";
import { FILE_TYPE_ICONS } from "./fileTypeIcons.generated";

/** Whole-name matches (lowercased), checked before the extension — the IDE "special file" icons. */
const BY_NAME: Record<string, string> = {
  dockerfile: "docker",
  "docker-compose.yml": "docker",
  "docker-compose.yaml": "docker",
  "compose.yml": "docker",
  "compose.yaml": "docker",
  ".dockerignore": "docker",
  "package.json": "npm",
  "package-lock.json": "npm",
  ".npmrc": "npm",
  "pnpm-lock.yaml": "pnpm",
  "pnpm-workspace.yaml": "pnpm",
  "yarn.lock": "yarn",
  ".yarnrc": "yarn",
  "pyproject.toml": "python",
  "poetry.lock": "poetry",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  ".editorconfig": "editorconfig",
  ".prettierignore": "prettier",
  ".eslintignore": "eslint",
  "build.gradle": "gradle",
  "settings.gradle": "gradle",
  ".env": "dotenv",
};

/** Name prefixes (lowercased) for config files that come in many extensions, e.g. `vite.config.ts`. */
const BY_PREFIX: [string, string][] = [
  [".env.", "dotenv"],
  ["dockerfile.", "docker"],
  ["vite.config.", "vite"],
  ["vitest.config.", "vitest"],
  ["jest.config.", "jest"],
  ["eslint.config.", "eslint"],
  [".eslintrc", "eslint"],
  ["prettier.config.", "prettier"],
  [".prettierrc", "prettier"],
];

/** Last-extension matches (lowercased, without the dot). */
const BY_EXTENSION: Record<string, string> = {
  py: "python",
  pyi: "python",
  pyw: "python",
  ipynb: "jupyter",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "react",
  jsx: "react",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  css: "css",
  scss: "sass",
  sass: "sass",
  less: "less",
  html: "html5",
  htm: "html5",
  svg: "svg",
  xml: "xml",
  xaml: "xml",
  axaml: "xml",
  sh: "gnubash",
  bash: "gnubash",
  zsh: "gnubash",
  cs: "dotnet",
  csproj: "dotnet",
  fs: "dotnet",
  fsproj: "dotnet",
  sln: "dotnet",
  go: "go",
  rs: "rust",
  java: "openjdk",
  kt: "kotlin",
  kts: "kotlin",
  gradle: "gradle",
  swift: "swift",
  php: "php",
  rb: "ruby",
  c: "c",
  h: "c",
  cpp: "cplusplus",
  cc: "cplusplus",
  cxx: "cplusplus",
  hpp: "cplusplus",
  graphql: "graphql",
  gql: "graphql",
  dart: "dart",
  lua: "lua",
  r: "r",
  scala: "scala",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  vue: "vuedotjs",
  svelte: "svelte",
  prisma: "prisma",
  sqlite: "sqlite",
  tf: "terraform",
  pl: "perl",
  pm: "perl",
  zig: "zig",
};

/** The file-type logo slug for a file name (special name, then config prefix, then extension), or null. */
export function fileTypeSlug(fileName: string): string | null {
  const name = fileName.toLowerCase();
  const dot = name.lastIndexOf(".");
  return (
    BY_NAME[name] ??
    BY_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1] ??
    (dot >= 0 ? BY_EXTENSION[name.slice(dot + 1)] : undefined) ??
    null
  );
}

/** Every slug the tables above can return, so a test can check each one has a generated logo. */
export const MAPPED_FILE_TYPE_SLUGS = new Set([
  ...Object.values(BY_NAME),
  ...BY_PREFIX.map(([, slug]) => slug),
  ...Object.values(BY_EXTENSION),
]);

/** The Files panel background, a copy of `--bg-panel` in `web/src/styles.css`. */
export const PANEL_BACKGROUND = "#15181f";

/** The open/active file row background, a copy of `--accent-bg` in `web/src/styles.css`. */
export const ACTIVE_ROW_BACKGROUND = "#2b3550";

/** Lowest contrast at which a logo keeps its own color: WCAG 3:1 for non-text graphics. */
const MIN_CONTRAST = 3;

/** Light grey that pure-black logos (Markdown, Rust, JSON...) lighten toward, keeping hues for the rest. */
const LIGHTEN_TARGET = [201, 209, 217];

/** The lower of a color's contrasts on the two row backgrounds a logo can sit on. */
function worstContrast(color: string): number {
  return Math.min(contrastRatio(color, PANEL_BACKGROUND), contrastRatio(color, ACTIVE_ROW_BACKGROUND));
}

/** The logo's brand color, lightened in 10% steps until it stays legible on plain and open rows. */
export function fileTypeFill(hex: string): string {
  const brand = rgbChannels(`#${hex}`) ?? LIGHTEN_TARGET;
  for (let step = 0; step < 10; step += 1) {
    const color = rgbHex(brand.map((c, i) => Math.round(c + ((LIGHTEN_TARGET[i] - c) * step) / 10)));
    if (worstContrast(color) >= MIN_CONTRAST) return step === 0 ? `#${hex}` : color;
  }
  return rgbHex(LIGHTEN_TARGET);
}

/** Path and legible fill per slug, resolved once at load so rows never redo the contrast math. */
const FILE_TYPE_GLYPHS: Record<string, { path: string; fill: string }> = Object.fromEntries(
  Object.entries(FILE_TYPE_ICONS).map(([slug, entry]) => [slug, { path: entry.path, fill: fileTypeFill(entry.hex) }]),
);

/** The logo to draw for a file name, or null when its type has none. */
export function fileTypeGlyph(fileName: string): { slug: string; path: string; fill: string } | null {
  const slug = fileTypeSlug(fileName);
  const glyph = slug ? FILE_TYPE_GLYPHS[slug] : undefined;
  return slug && glyph ? { slug, ...glyph } : null;
}
