import { collapsedLayersStore } from "../canvas/doc/collapsedLayersStore";
import { canvasDocStore, collectActiveLayers } from "../canvas/doc/canvasDocStore";
import { descriptionPopupStore } from "../canvas/doc/descriptionPopupStore";
import { removeLayerAndRefresh, runRecipeAndLayout } from "../canvas/doc/diagramCatalog";
import { seedLayerPositions } from "../canvas/doc/layerPositionCache";
import { inspectorStore } from "../canvas/inspectorStore";
import { openFilesStore } from "../canvas/openFilesStore";
import { projectTreePanelStore } from "../canvas/projectTreePanelStore";
import type { EngineClient } from "../engine-client/EngineClient";
import { selectionStore } from "../state/selectionStore";
import { TUTORIAL_LAYOUTS } from "./tutorialLayouts";
import { tutorialSimStore } from "./tutorialSim";

const DIAGRAM_LAYERS = ["c1", "patterns", "impact"];
const STAGE_DIAGRAM = "patterns";
const SETTLE_MS = 700;

let latest = 0;

/** What each stage starts with, whatever the user did before (or whichever stage they jumped from):
 * stages 1-2 an empty canvas, stages 3-4 only the design patterns diagram in its saved layout; no
 * windows, panels, plans or simulated agents beyond what the stage itself brings. */
export async function applyStageState(stage: number, engineClient: EngineClient): Promise<void> {
  const mine = ++latest;
  tutorialSimStore.beginStage(stage);
  descriptionPopupStore.close();
  inspectorStore.close();
  selectionStore.clear();
  collapsedLayersStore.reset();
  projectTreePanelStore.reset();
  openFilesStore.reset();

  const placed = collectActiveLayers(canvasDocStore.getDoc());
  await Promise.all(
    DIAGRAM_LAYERS.filter((layer) => placed.has(layer)).map((layer) =>
      removeLayerAndRefresh(engineClient, layer).catch(() => undefined),
    ),
  );
  if ((stage === 3 || stage === 4) && mine === latest) {
    const saved = TUTORIAL_LAYOUTS[STAGE_DIAGRAM];
    if (saved) seedLayerPositions(STAGE_DIAGRAM, saved);
    await runRecipeAndLayout(engineClient, STAGE_DIAGRAM).catch(() => undefined);
    window.setTimeout(tutorialSimStore.fitCanvas, 300);
  }
  if (mine === latest) window.setTimeout(() => mine === latest && tutorialSimStore.endStage(), SETTLE_MS);
}
