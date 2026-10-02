// Plain JS on purpose: same convention as launcher/launcher.js -- this page has no build step, so
// it stays out of the tsc build. Its typed contract is src/tabbarPreload.ts's TabBarApi.
const api = window.tabBar;

const tabsEl = document.getElementById("tabs");
const newTabButton = document.getElementById("new-tab");

function render(payload) {
  tabsEl.replaceChildren();
  for (const tab of payload.tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === payload.activeId ? " active" : "");
    el.addEventListener("mousedown", () => void api.switchTab(tab.id));

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = tab.title;
    title.title = tab.title;
    el.append(title);

    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "×";
    close.title = "Close tab";
    close.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      void api.closeTab(tab.id);
    });
    el.append(close);

    tabsEl.append(el);
  }
}

newTabButton.addEventListener("click", () => void api.newTab());
api.onChanged(render);

render(await api.listTabs());
