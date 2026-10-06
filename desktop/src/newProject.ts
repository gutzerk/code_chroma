import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INVALID_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

/** Returns why `name` can't be a project folder name, or null when it is fine. */
export function validateProjectName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a project name.";
  if (trimmed === "." || trimmed === ".." || trimmed.endsWith(".")) return "Invalid project name.";
  if (INVALID_NAME.test(trimmed)) return 'The name can\'t contain \\ / : * ? " < > |.';
  return null;
}

function scaffoldFiles(name: string): Record<string, string> {
  return {
    "README.md": `# ${name}\n\nCreated with CodeChroma.\n`,
    ".gitignore": ".codechroma/\n__pycache__/\nnode_modules/\n.venv/\n",
    "src/main.py": `def main() -> None:\n    print("Hello from ${name.replace(/["\\\n]/g, "")}")\n\n\nif __name__ == "__main__":\n    main()\n`,
  };
}

/** Creates `<parentDir>/<name>` with a minimal scaffold and `git init`; returns the new path. */
export function createProject(parentDir: string, name: string): string {
  const problem = validateProjectName(name);
  if (problem) throw new Error(problem);
  if (!existsSync(parentDir)) throw new Error(`Directory does not exist: ${parentDir}`);

  const clean = name.trim();
  const root = join(parentDir, clean);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(`${root} already exists and is not empty.`);
  }
  mkdirSync(root, { recursive: true });

  for (const [relative, content] of Object.entries(scaffoldFiles(clean))) {
    const target = join(root, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  } catch {
    // git missing: the project still opens; the bridge copes with a non-git folder.
  }
  return root;
}
