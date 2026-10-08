import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const TUTORIAL_PROJECT_NAME = "codechroma-tutorial";

const TUTORIAL_FILES: Record<string, string> = {
  "README.md": `# Todo app (CodeChroma tutorial)

A tiny three-tier app: a TypeScript frontend, a Python backend and a SQLite database.
Open it in CodeChroma to learn how to read a codebase as a map.
`,
  ".gitignore": ".codechroma/\n__pycache__/\n*.db\n",

  "frontend/api.ts": `export interface Todo {
  id: number;
  title: string;
  done: boolean;
}

const BASE_URL = "http://localhost:8000";

export async function fetchTodos(): Promise<Todo[]> {
  const response = await fetch(\`\${BASE_URL}/todos\`);
  return response.json();
}

export async function createTodo(title: string): Promise<Todo> {
  const response = await fetch(\`\${BASE_URL}/todos\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return response.json();
}

export async function completeTodo(id: number): Promise<Todo> {
  const response = await fetch(\`\${BASE_URL}/todos/\${id}/done\`, { method: "POST" });
  return response.json();
}
`,
  "frontend/ui.ts": `import { completeTodo, createTodo, fetchTodos, type Todo } from "./api";

export function renderTodo(todo: Todo): string {
  const mark = todo.done ? "[x]" : "[ ]";
  return \`\${mark} \${todo.title}\`;
}

export async function showTodos(container: HTMLElement): Promise<void> {
  const todos = await fetchTodos();
  container.innerHTML = todos.map(renderTodo).join("\\n");
}

export async function onAddClicked(input: HTMLInputElement, container: HTMLElement): Promise<void> {
  if (!input.value.trim()) return;
  await createTodo(input.value);
  input.value = "";
  await showTodos(container);
}

export async function onDoneClicked(id: number, container: HTMLElement): Promise<void> {
  await completeTodo(id);
  await showTodos(container);
}
`,

  "backend/__init__.py": "",
  "backend/app.py": `from backend.service import add_todo, finish_todo, list_all_todos


def handle_get_todos() -> list[dict]:
    return list_all_todos()


def handle_create_todo(payload: dict) -> dict:
    return add_todo(payload["title"])


def handle_complete_todo(todo_id: int) -> dict:
    return finish_todo(todo_id)
`,
  "backend/service.py": `from db import repository


def validate_title(title: str) -> str:
    cleaned = title.strip()
    if not cleaned:
        raise ValueError("A todo needs a title")
    return cleaned


def list_all_todos() -> list[dict]:
    return repository.fetch_all()


def add_todo(title: str) -> dict:
    return repository.insert(validate_title(title))


def finish_todo(todo_id: int) -> dict:
    return repository.mark_done(todo_id)


def search_todos(query: str) -> list[dict]:
    return repository.search(query.strip())


def count_open_todos() -> int:
    return repository.count_open()
`,

  "db/__init__.py": "",
  "db/schema.py": `import sqlite3

DB_PATH = "todos.db"


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute(
        "CREATE TABLE IF NOT EXISTS todos ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "title TEXT NOT NULL, "
        "done INTEGER NOT NULL DEFAULT 0)"
    )
    return connection
`,
  "db/repository.py": `from db.schema import connect


def fetch_all() -> list[dict]:
    with connect() as connection:
        rows = connection.execute("SELECT id, title, done FROM todos ORDER BY id").fetchall()
    return [dict(row) for row in rows]


def insert(title: str) -> dict:
    with connect() as connection:
        cursor = connection.execute("INSERT INTO todos (title) VALUES (?)", (title,))
        return {"id": cursor.lastrowid, "title": title, "done": 0}


def mark_done(todo_id: int) -> dict:
    with connect() as connection:
        connection.execute("UPDATE todos SET done = 1 WHERE id = ?", (todo_id,))
        row = connection.execute(
            "SELECT id, title, done FROM todos WHERE id = ?", (todo_id,)
        ).fetchone()
    return dict(row)


def search(query: str) -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT id, title, done FROM todos WHERE title LIKE ? ORDER BY id",
            (f"%{query}%",),
        ).fetchall()
    return [dict(row) for row in rows]


def count_open() -> int:
    with connect() as connection:
        row = connection.execute("SELECT COUNT(*) AS open FROM todos WHERE done = 0").fetchone()
    return row["open"]
`,
  ".codechroma/diagrams/patterns/patterns.json": JSON.stringify(
    {
      type: "patterns",
      nodes: [
        {
          id: "infra::frontend",
          name: "Frontend",
          kind: "infra",
          path: "frontend/api.ts",
          node_id: "component::frontend/api.ts",
          description: "The browser code that sends requests to the backend.",
        },
        {
          id: "infra::handlers",
          name: "Request handlers",
          kind: "infra",
          path: "backend/app.py",
          node_id: "component::backend/app.py",
          description:
            "Receives each request and passes it to the service layer.",
        },
        {
          id: "facade::todo_service",
          name: "Facade: service layer",
          kind: "pattern-instance",
          description:
            "One small set of functions the handlers call, so they never touch the database directly.",
          meta: {
            type: "facade",
            confirmed: true,
            confidence: 0.9,
          },
        },
        {
          id: "fn::list_all_todos",
          parent: "facade::todo_service",
          name: "list_all_todos",
          node_id: "backend/service.py::function::list_all_todos",
          path: "backend/service.py",
          description: "Returns every item.",
          meta: {
            role: "facade",
          },
        },
        {
          id: "fn::add_todo",
          parent: "facade::todo_service",
          name: "add_todo",
          node_id: "backend/service.py::function::add_todo",
          path: "backend/service.py",
          description: "Validates and creates an item.",
          meta: {
            role: "facade",
          },
        },
        {
          id: "fn::finish_todo",
          parent: "facade::todo_service",
          name: "finish_todo",
          node_id: "backend/service.py::function::finish_todo",
          path: "backend/service.py",
          description: "Marks an item as done.",
          meta: {
            role: "facade",
          },
        },
        {
          id: "repository::todo_repository",
          name: "Repository: storage",
          kind: "pattern-instance",
          description:
            "All SQL lives here, so the rest of the app does not know how data is stored.",
          meta: {
            type: "repository",
            confirmed: true,
            confidence: 0.9,
          },
        },
        {
          id: "fn::fetch_all",
          parent: "repository::todo_repository",
          name: "fetch_all",
          node_id: "db/repository.py::function::fetch_all",
          path: "db/repository.py",
          description: "Loads every item.",
          meta: {
            role: "implementation",
          },
        },
        {
          id: "fn::insert",
          parent: "repository::todo_repository",
          name: "insert",
          node_id: "db/repository.py::function::insert",
          path: "db/repository.py",
          description: "Saves a new item.",
          meta: {
            role: "implementation",
          },
        },
        {
          id: "fn::mark_done",
          parent: "repository::todo_repository",
          name: "mark_done",
          node_id: "db/repository.py::function::mark_done",
          path: "db/repository.py",
          description: "Flags an item as done.",
          meta: {
            role: "implementation",
          },
        },
        {
          id: "ext::sqlite",
          name: "SQLite",
          kind: "external",
          description: "The database file.",
        },
      ],
      relations: [
        {
          from: "infra::frontend",
          to: "infra::handlers",
          kind: "uses",
          label: "HTTP",
        },
        {
          from: "infra::handlers",
          to: "facade::todo_service",
          kind: "uses",
          label: "calls",
        },
        {
          from: "facade::todo_service",
          to: "repository::todo_repository",
          kind: "uses",
          label: "stores via",
        },
        {
          from: "repository::todo_repository",
          to: "ext::sqlite",
          kind: "uses",
          label: "SQL",
        },
        {
          from: "infra::handlers",
          to: "fn::list_all_todos",
          kind: "uses",
        },
        {
          from: "infra::handlers",
          to: "fn::add_todo",
          kind: "uses",
        },
        {
          from: "infra::handlers",
          to: "fn::finish_todo",
          kind: "uses",
        },
        {
          from: "fn::list_all_todos",
          to: "fn::fetch_all",
          kind: "uses",
        },
        {
          from: "fn::add_todo",
          to: "fn::insert",
          kind: "uses",
        },
        {
          from: "fn::finish_todo",
          to: "fn::mark_done",
          kind: "uses",
        },
        {
          from: "fn::fetch_all",
          to: "ext::sqlite",
          kind: "uses",
        },
        {
          from: "fn::insert",
          to: "ext::sqlite",
          kind: "uses",
        },
        {
          from: "fn::mark_done",
          to: "ext::sqlite",
          kind: "uses",
        },
      ],
    },
    null,
    2,
  ),
  ".codechroma/diagrams/impact/impact.json": JSON.stringify(
    {
      type: "impact",
      source: "diff",
      nodes: [
        {
          id: "backend/service.py::function::validate_title",
          name: "validate_title",
          node_id: "backend/service.py::function::validate_title",
          seed: true,
          description: "New check that rejects empty todo titles.",
          meta: {
            status: "new",
          },
        },
        {
          id: "backend/service.py::function::add_todo",
          name: "add_todo",
          node_id: "backend/service.py::function::add_todo",
          seed: true,
          description: "Now validates the title before saving it.",
          meta: {
            status: "modified",
          },
        },
        {
          id: "backend/app.py::function::handle_create_todo",
          name: "handle_create_todo",
          node_id: "backend/app.py::function::handle_create_todo",
          seed: false,
          description: "The request handler that calls add_todo. Unchanged.",
          meta: {
            status: "context",
          },
        },
        {
          id: "db/repository.py::function::insert",
          name: "insert",
          node_id: "db/repository.py::function::insert",
          seed: false,
          description: "Writes the todo to SQLite. Unchanged.",
          meta: {
            status: "context",
          },
        },
      ],
      relations: [
        {
          from: "backend/app.py::function::handle_create_todo",
          to: "backend/service.py::function::add_todo",
          label: "calls",
          hero: true,
        },
        {
          from: "backend/service.py::function::add_todo",
          to: "backend/service.py::function::validate_title",
          label: "checks the title",
        },
        {
          from: "backend/service.py::function::add_todo",
          to: "db/repository.py::function::insert",
          label: "saves",
        },
      ],
    },
    null,
    2,
  ),
  ".codechroma/diagrams/c1/c1.json": JSON.stringify(
    {
      type: "c1",
      style: "boxes-arrows",
      nodes: [
        {
          id: "system",
          kind: "system",
          name: "Todo app",
          description:
            "A small todo list: a web frontend, a Python backend and a SQLite database.",
        },
        {
          id: "todo-user",
          kind: "person",
          name: "Todo user",
          description: "Adds todos and marks them done in the browser.",
        },
        {
          id: "sqlite",
          kind: "external_system",
          name: "SQLite",
          icon: "sqlite",
          description: "Stores every todo in a local database file.",
          meta: { technology: "SQL" },
        },
      ],
      relations: [
        { from: "todo-user", to: "system", label: "Adds and completes todos" },
        { from: "system", to: "sqlite", label: "Reads and writes todos" },
      ],
    },
    null,
    2,
  ),
};

const BASELINE_FILES: Record<string, string> = {
  "backend/service.py": `from db import repository


def list_all_todos() -> list[dict]:
    return repository.fetch_all()


def add_todo(title: str) -> dict:
    return repository.insert(title)


def finish_todo(todo_id: int) -> dict:
    return repository.mark_done(todo_id)
`,
};

const GIT_IDENTITY = [
  "-c",
  "user.name=CodeChroma Tutorial",
  "-c",
  "user.email=tutorial@codechroma.local",
];

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
}

function hasCommit(root: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** Writes the tutorial example project into `<parentDir>/codechroma-tutorial` and returns its path; re-calling restores the files. */
export function createTutorialProject(parentDir: string): string {
  const root = join(parentDir, TUTORIAL_PROJECT_NAME);
  writeFiles(root, TUTORIAL_FILES);
  try {
    if (!existsSync(join(root, ".git"))) {
      execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    }
    if (!hasCommit(root)) {
      // Commit an older service.py, then restore the current one: the uncommitted change is what
      // the lesson's "Change impact" diagram describes.
      writeFiles(root, BASELINE_FILES);
      execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
      execFileSync(
        "git",
        [...GIT_IDENTITY, "commit", "-q", "-m", "Initial todo app"],
        {
          cwd: root,
          stdio: "ignore",
        },
      );
      writeFiles(root, TUTORIAL_FILES);
    }
  } catch {
    // git missing: the project still opens; the bridge copes with a non-git folder.
  }
  return root;
}
