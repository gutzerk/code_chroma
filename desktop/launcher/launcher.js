// Plain JS on purpose: this page loads from file:// before any bridge exists, so it stays
// out of the tsc build and has no imports to resolve. Its typed contract is preload.ts's LauncherApi.
const api = window.launcher;

const recentsEl = document.getElementById("recents");
const recentsPanel = document.getElementById("recents-panel");
const statusEl = document.getElementById("status");
const openButton = document.getElementById("open");

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", Boolean(isError));
}

function setBusy(busy) {
  openButton.disabled = busy;
  for (const button of recentsEl.querySelectorAll("button")) {
    button.disabled = busy;
  }
}

async function open(repoPath) {
  // Guard against a second click racing in before the first disables the buttons: once a repo is
  // chosen, nothing further is clickable until the window navigates to the loading canvas.
  if (openButton.disabled) return;
  setBusy(true);
  setStatus("Starting…");
  await api.openRepo(repoPath);
}

function renderRecents(recents) {
  recentsPanel.classList.toggle("hidden", recents.length === 0);
  recentsEl.replaceChildren();
  for (const repo of recents) {
    const button = document.createElement("button");
    button.className = "recent";
    button.textContent = repo.name;
    const path = document.createElement("span");
    path.className = "path";
    path.textContent = repo.path;
    button.append(path);
    button.addEventListener("click", () => void open(repo.path));
    recentsEl.append(button);
  }
}

openButton.addEventListener("click", async () => {
  const picked = await api.pickFolder();
  if (picked) {
    await open(picked);
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
