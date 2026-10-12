// Plain JS on purpose: same convention as launcher/launcher.js -- no build step for this page.
// Its typed contract is src/branchPickerPreload.ts's BranchPickerApi.
const api = window.branchPicker;

const listEl = document.getElementById("branches");
const newForm = document.getElementById("new-form");
const nameInput = document.getElementById("new-name");
const fromSelect = document.getElementById("new-from");
const openButton = document.getElementById("open");
const modeInputs = document.querySelectorAll('input[name="mode"]');

let selected = null;

function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function refresh() {
  const isNew = mode() === "new";
  listEl.style.display = isNew ? "none" : "block";
  newForm.style.display = isNew ? "flex" : "none";
  openButton.disabled = isNew ? nameInput.value.trim() === "" : selected === null;
  openButton.textContent = !isNew && selected && selected.open ? "Go to it" : "Open";
}

function renderBranches(branches) {
  listEl.replaceChildren();
  for (const branch of branches) {
    const row = document.createElement("div");
    row.className = "branch";
    row.dataset.name = branch.name;
    const name = document.createElement("span");
    name.textContent = branch.name;
    row.append(name);
    if (branch.open) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "open";
      row.append(tag);
    }
    row.addEventListener("click", () => {
      selected = branch;
      for (const el of listEl.children) el.classList.toggle("selected", el === row);
      refresh();
    });
    listEl.append(row);
  }
}

for (const input of modeInputs) input.addEventListener("change", refresh);
nameInput.addEventListener("input", refresh);

document.getElementById("cancel").addEventListener("click", () => void api.submit({ kind: "cancel" }));
openButton.addEventListener("click", () => {
  if (mode() === "new") {
    void api.submit({ kind: "new", name: nameInput.value.trim(), from: fromSelect.value });
  } else if (selected) {
    void api.submit({ kind: "branch", name: selected.name });
  }
});

api.getState().then((state) => {
  document.getElementById("title").textContent = `Open ${state.project} again`;
  renderBranches(state.choices.branches);
  for (const branch of state.choices.branches) {
    const option = document.createElement("option");
    option.value = branch.name;
    option.textContent = branch.name;
    option.selected = branch.name === state.choices.current;
    fromSelect.append(option);
  }
  refresh();
});
