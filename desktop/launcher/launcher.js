// Plain JS on purpose: this page loads from file:// before any bridge exists, so it stays
// out of the tsc build and has no imports to resolve. Its typed contract is preload.ts's LauncherApi.
const api = window.launcher;

const recentsEl = document.getElementById("recents");
const recentsPanel = document.getElementById("recents-panel");
const statusEl = document.getElementById("status");
const openButton = document.getElementById("open");
const tutorialButton = document.getElementById("tutorial");
const newToggle = document.getElementById("new-toggle");
const newForm = document.getElementById("new-form");
const newName = document.getElementById("new-name");
const newBrowse = document.getElementById("new-browse");
const newLocation = document.getElementById("new-location");
const newCreate = document.getElementById("new-create");
let newParentDir = null;

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", Boolean(isError));
}

function setBusy(busy) {
  openButton.disabled = busy;
  tutorialButton.disabled = busy;
  newToggle.disabled = busy;
  newCreate.disabled = busy;
  for (const button of recentsEl.querySelectorAll("button")) {
    button.disabled = busy;
  }
}

async function open(repoPath, workspaceId) {
  // Guard against a second click racing in before the first disables the buttons: once a repo is
  // chosen, nothing further is clickable until the window navigates to the loading canvas.
  if (openButton.disabled) return;
  setBusy(true);
  setStatus("Starting…");
  await api.openRepo(repoPath, workspaceId);
}

/** One recent project's workspace children (agents/PRs), read from its `.codechroma/*.json` --
 * shown as a nested row list so a project opens straight into that task context (#87's
 * "Recent Projects: display Workspaces as child items"). Empty when the repo has none, or on any
 * read error (listWorkspaces is best-effort). */
function renderWorkspaceRows(container, repoPath, workspaces) {
  for (const workspace of workspaces) {
    const row = document.createElement("button");
    row.className = "recent workspace";
    row.textContent = workspace.label;
    row.addEventListener("mousedown", (event) => event.stopPropagation());
    row.addEventListener("click", (event) => {
      event.stopPropagation();
      void open(repoPath, workspace.id);
    });
    container.append(row);
  }
}

function renderRecents(recents) {
  recentsPanel.classList.toggle("hidden", recents.length === 0);
  recentsEl.replaceChildren();
  for (const repo of recents) {
    const entry = document.createElement("div");
    entry.className = "recent-entry";

    const button = document.createElement("button");
    button.className = "recent";
    button.textContent = repo.name;
    const path = document.createElement("span");
    path.className = "path";
    path.textContent = repo.path;
    button.append(path);
    button.addEventListener("click", () => void open(repo.path));
    entry.append(button);

    const children = document.createElement("div");
    children.className = "recent-workspaces";
    entry.append(children);
    recentsEl.append(entry);

    // Fire-and-forget per entry: one repo's unreadable `.codechroma/` must never block the rest
    // of the list from rendering.
    void api
      .listWorkspaces(repo.path)
      .then((workspaces) => renderWorkspaceRows(children, repo.path, workspaces))
      .catch(() => {});
  }
}

openButton.addEventListener("click", async () => {
  const picked = await api.pickFolder();
  if (picked) {
    await open(picked);
  }
});

tutorialButton.addEventListener("click", async () => {
  if (openButton.disabled) return;
  try {
    await open(await api.createTutorial());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true);
  }
});

newToggle.addEventListener("click", () => {
  newForm.classList.toggle("hidden");
  if (!newForm.classList.contains("hidden")) newName.focus();
});

newBrowse.addEventListener("click", async () => {
  const picked = await api.pickFolder();
  if (picked) {
    newParentDir = picked;
    newLocation.textContent = picked;
  }
});

newForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (openButton.disabled) return;
  if (!newParentDir) {
    setStatus("Choose where to create the project.", true);
    return;
  }
  try {
    const created = await api.createProject(newParentDir, newName.value);
    await open(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true);
  }
});

api.onProgress((line) => {
  // The bridge prints "analyzing <path>" then "ready"; uvicorn's own lines follow.
  setStatus(line.startsWith("analyzing ") ? `Analyzing ${line.slice(10)}…` : line);
});

api.onError((message) => {
  setBusy(false);
  setStatus(message, true);
});

renderRecents(await api.listRecents());
