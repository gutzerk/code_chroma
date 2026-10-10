import { useCallback, useEffect, useState } from "react";
import type { DiagramEventKind, EngineClient } from "../../engine-client/EngineClient";
import { diagramHealthStore } from "../../state/diagramHealthStore";
import type {
  CanvasDoc,
  CanvasOp,
  CanvasPosition,
  DiagramsStatus,
  DiagramTypeSummary,
} from "../../state/types";
import { recipeChromeKey } from "../../state/useSidecar";
import { stringMeta } from "./elementMeta";
import { layoutNewElements } from "./autoLayout";
import { isEpicsLayerName, parentEpicKey } from "./epicsLayout";
import { BLOCK_RULES } from "./elementRules";
import { canvasDocStore, collectActiveLayers, patchCanvasDoc } from "./canvasDocStore";
import { captureLayerPositions, takeCachedPosition } from "./layerPositionCache";

export interface BuiltinRecipe {
  name: string;
  label: string;
  /** Screen-reader accessible name, when `label` alone is too terse to stand on its own (e.g. "C1"
   * assumes C4-model familiarity) — falls back to `label` when unset. */
  accessibleName?: string;
  /** Whether this recipe draws a generated artifact, i.e. whether `DiagramsStatus` gates it at all. */
  generated?: boolean;
}

/** The recipe registry's built-in names/labels (`src/codechroma/canvas/recipes.py`'s `RECIPES`) —
 * every `custom/<id>` type is fetched instead of hardcoded (see `useCustomDiagramTypes` below).
 * Shared between `DrawDiagramButton`'s task-prompt wording and `AgentRail`'s Diagrams tab, so both
 * agree on what a diagram layer is and what it's called. */
export const BUILTIN_RECIPES: BuiltinRecipe[] = [
  { name: "c1", label: "C1", accessibleName: "C1 — system context diagram", generated: true },
  { name: "patterns", label: "Design patterns", generated: true },
  { name: "impact", label: "Change impact", generated: true },
  { name: "epics", label: "Epics", generated: true },
  { name: "sequence", label: "Sequence", accessibleName: "Sequence — порядок вызовов", generated: true },
];

/** The only two layer names that are never a diagram: the seeded hierarchy tree, and
 * `apply_batch`'s own fallback layer for a batch that named none (e.g. a standalone note). */
const NON_DIAGRAM_LAYERS = new Set(["hierarchy", "default"]);

/** Every "<prefix>/<id>" layer kind that's lazily synthesized rather than a `BUILTIN_RECIPES` entry
 * (mirrors `canvas/recipes.py`'s `_SYNTHESIZED_PREFIXES`) — extend this, not `isRecipeBackedLayer`. */
const SYNTHESIZED_LAYER_PREFIXES = ["custom/", "feature-plan/", "epics/"];

/** Every diagram layer currently on the canvas, excluding `NON_DIAGRAM_LAYERS` -- deliberately a
 * deny-list, not an allow-list of builtin/`custom/<id>` names: `PATCH /repos/{id}/canvas` accepts
 * any `layer` string (`routes/canvas.py`), so a skill/agent can write a one-off diagram under a
 * freeform layer name with no registered recipe behind it, and that still belongs in the Diagrams
 * tab's row list, which is built from this. (Past bug: an allow-list here silently hid exactly that
 * kind of diagram, even though it was really on the canvas.) See `isRecipeBackedLayer` below for the
 * separate question of whether a given layer's row can be refreshed. */
export function listActiveDiagramLayers(doc: CanvasDoc): string[] {
  return [...collectActiveLayers(doc)].filter(isDiagramLayer);
}

/** Whether `layer` names a real diagram rather than the seeded hierarchy tree or `apply_batch`'s
 * fallback layer -- the single predicate `listActiveDiagramLayers` filters on above, exported so
 * `DiagramFrame`'s own per-layer bucketing in `CanvasDocView` doesn't need a second copy of the
 * deny-list. */
export function isDiagramLayer(layer: string): boolean {
  return !NON_DIAGRAM_LAYERS.has(layer);
}

/** The short title of a per-EP box label, e.g. `EP-1 · Zoomable semantic map` -> `Zoomable semantic
 * map`. Used so the Diagrams tab can name an epics layer by its epic instead of the generic "Epics".
 * Falls back to the raw label when it lacks the `EP-x · ` prefix (a plain-title story). */
function shortEpicTitle(label: string): string {
  return label.replace(/^EP-\d+ ·\s*/, "");
}

/** The short title of the first top-level epic box on an epics layer (`EP-A-01 · Foundation` ->
 * `Foundation`), or null when the layer has no top-level epic to name it by — the Diagrams tab's
 * epics-row label falls back to the layer's own `epics/<id>` id in that case. First top-level epic
 * is the one whose recipe_key equals itself (`parentEpicKey(id) === id`), i.e. not a nested story. */
export function epicsLayerShortTitle(doc: CanvasDoc, layer: string): string | null {
  const epic = Object.values(doc.elements).find(
    (element) =>
      element.layer === layer && parentEpicKey(stringMeta(element, "recipe_key") || element.id) === (stringMeta(element, "recipe_key") || element.id),
  );
  return epic ? shortEpicTitle(epic.label) : null;
}

/** Resolves a diagram layer key to its display label, for a builtin, a custom type, a feature's own
 * Feature-plan diagram (055-diagram-feature-plan), or a per-epic diagram (`epics/<id>`); falls back
 * to the raw layer key for a custom type whose title hasn't loaded yet. An optional `doc` lets an
 * epics layer name itself by its first top-level epic's short title (e.g. "Zoomable semantic map")
 * instead of the raw `epics/<id>` key. */
export function labelForDiagramLayer(
  layer: string,
  customTypes: DiagramTypeSummary[],
  doc?: CanvasDoc,
): string {
  if (isEpicsLayerName(layer) && doc) {
    const shortTitle = epicsLayerShortTitle(doc, layer);
    if (shortTitle) return shortTitle;
  }
  const builtin = BUILTIN_RECIPES.find((recipe) => recipe.name === layer);
  if (builtin) return builtin.label;
  const custom = customTypes.find((type) => `custom/${type.id}` === layer);
  if (custom) return custom.title;
  if (layer.startsWith("feature-plan/")) return `Feature plan: ${layer.slice("feature-plan/".length)}`;
  if (layer.startsWith("epics/")) return layer.slice("epics/".length);
  return layer;
}

/** Whether `layer` names a real recipe the bridge's `POST /recipes/{recipe}/run` knows how to
 * reconcile (`canvas/recipes.py`'s `recipe_for` -- a builtin name, `custom/<id>`, or
 * `feature-plan/<slug>`), as opposed to a one-off layer a skill/agent PATCHed straight onto the
 * canvas with no backing artifact (see `listActiveDiagramLayers` above). `AgentRail`'s
 * expand-refresh only fires for the former: calling `runRecipeAndLayout` for the latter has nothing
 * to re-resolve and 404s (`recipe_for` raises `KeyError`) every single time. */
export function isRecipeBackedLayer(layer: string): boolean {
  return (
    BUILTIN_RECIPES.some((recipe) => recipe.name === layer) ||
    SYNTHESIZED_LAYER_PREFIXES.some((prefix) => layer.startsWith(prefix))
  );
}

/** Whether `layer` has an on-disk artifact a delete action should also remove -- every generated
 * built-in (`c1`/`patterns`/`impact`/`epics` — epics is skill-generated now) and every synthesized
 * layer; false for a freeform layer a skill/agent PATCHed straight onto the canvas with no backing
 * route. Deleting one of those layers still removes it from the canvas via `removeLayerAndRefresh`;
 * it just skips the file-delete call that would otherwise 404. */
export function hasDeletableDiagramArtifact(layer: string): boolean {
  const builtin = BUILTIN_RECIPES.find((recipe) => recipe.name === layer);
  // No builtin match means isRecipeBackedLayer's own builtin check is already false, so it
  // reduces to exactly the synthesized-prefix check this would otherwise repeat.
  return builtin ? builtin.generated === true : isRecipeBackedLayer(layer);
}

/** Fetches saved custom diagram types once, then keeps them fresh on every "custom" diagram ping (a
 * new type saved, or an existing one regenerated) -- the Diagrams tab's own copy of the live-refresh
 * DrawDiagramButton keeps for its own list, kept separate since that button only fetches on demand. */
export function useCustomDiagramTypes(engineClient: EngineClient): DiagramTypeSummary[] {
  const [customTypes, setCustomTypes] = useState<DiagramTypeSummary[]>([]);

  const refetch = useCallback(() => {
    void engineClient.listDiagramTypes().then(setCustomTypes).catch(() => {});
  }, [engineClient]);

  useEffect(() => {
    refetch();
    return engineClient.subscribeDiagram("custom", refetch);
  }, [engineClient, refetch]);

  return customTypes;
}

/** The channels a newly-written diagram arrives on. Bare `"custom"` is one coarse ping shared by
 * every saved type (`workspaces.py`'s `on_custom_change`), so a `"custom"` ping also means "refetch
 * the type list", not just "refetch status" -- both `DrawDiagramButton` and `useDiagramsStatus` below
 * watch the same set so they never disagree about what counts as a diagram ping. `epics` is in here
 * (unlike the status fetch alone, which already covers it) so a freshly written `epics.json` also
 * drives the auto-place-the-layer flow, not just the readiness map. */
export const WATCHED_DIAGRAM_EVENT_KINDS: DiagramEventKind[] = ["c1", "epics", "patterns", "impact", "sequence", "custom"];

/** Fetches `GET /repos/{id}/diagrams/status` once, then keeps it fresh on every diagram ping -- the
 * Diagrams tab's own copy of the readiness map `DrawDiagramButton` keeps for its own task text,
 * same duplication `useCustomDiagramTypes` above already accepts. This hook only refreshes the
 * readiness map; auto-adding a ready-but-unplaced diagram is `DrawDiagramButton`'s `refetchStatus`
 * (since that's the mounted component with the status subscriptions), not this hook's concern. */
export function useDiagramsStatus(engineClient: EngineClient): DiagramsStatus | null {
  const [status, setStatus] = useState<DiagramsStatus | null>(null);

  const refetch = useCallback(() => {
    void engineClient.getDiagramsStatus().then(setStatus).catch(() => {});
  }, [engineClient]);

  useEffect(() => {
    refetch();
    const unsubscribes = WATCHED_DIAGRAM_EVENT_KINDS.map((kind) =>
      engineClient.subscribeDiagram(kind, refetch),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [engineClient, refetch]);

  return status;
}

export interface ReadyDiagrams {
  readyBuiltins: BuiltinRecipe[];
  readyCustomTypes: DiagramTypeSummary[];
  /** What the drawing agent's task prompt reads. */
  missingLabels: string[];
  /** Every built-in + saved custom type label, regardless of what's already drawn -- so "Draw…"
   * always offers the full menu and the user never has to remove a diagram to see it again. */
  allLabels: string[];
  anyGeneratedReady: boolean;
}

/** Splits every built-in recipe and saved custom type into ready/missing, given the latest readiness
 * map and the layers already on the canvas. Shared by `DrawDiagramButton` (to word its task prompt)
 * and `AgentRail`'s Diagrams tab (to offer a "ready but not placed" diagram back onto the canvas)
 * so the two can never disagree about what's ready.
 *
 * 🔴 Fails open. `status === null` means the route hasn't answered (or couldn't), and this filter's
 * only job is hiding a click that would no-op -- never hiding a diagram that exists. Treating unknown
 * as "not ready" would let one failed status fetch erase every generated diagram, with no error shown
 * and no way for the user to reach them again. */
export function computeReadyDiagrams(
  status: DiagramsStatus | null,
  customTypes: DiagramTypeSummary[],
  activeLayers: Set<string>,
): ReadyDiagrams {
  const isReady = (name: string) => {
    if (status === null) return true;
    const entry = status[name];
    return entry === undefined ? activeLayers.has(name) : entry.ready;
  };
  const isBuiltinReady = (recipe: BuiltinRecipe) => !recipe.generated || isReady(recipe.name);
  const isCustomReady = (type: DiagramTypeSummary) => isReady(`custom/${type.id}`);
  const readyBuiltins = BUILTIN_RECIPES.filter(isBuiltinReady);
  const readyCustomTypes = customTypes.filter(isCustomReady);
  const missingBuiltins = BUILTIN_RECIPES.filter((r) => !isBuiltinReady(r));
  const missingCustom = customTypes.filter((t) => !isCustomReady(t));
  return {
    readyBuiltins,
    readyCustomTypes,
    missingLabels: [...missingBuiltins.map((r) => r.label), ...missingCustom.map((t) => t.title)],
    allLabels: [...BUILTIN_RECIPES.map((r) => r.label), ...customTypes.map((t) => t.title)],
    anyGeneratedReady: readyBuiltins.some((r) => r.generated) || readyCustomTypes.length > 0,
  };
}

/** Runs `name`'s recipe, then auto-lays-out whatever it just added — the batch's own `id_map` (every
 * op that carried a `temp_id`) already names exactly the new elements/edges, so `layoutNewElements`
 * needs no extra bookkeeping to tell new from kept (016-single-canvas-dashboard: "only new_elements
 * get auto-positioned"). Adds the picked recipe's layer alongside whatever else is already on the
 * canvas -- several diagrams can coexist at once. Shared by `DrawDiagramButton`'s auto-add-when-ready
 * effect and `AgentRail`'s Diagrams tab (both its expand-refresh and its "add back" action).
 *
 * Before falling back to a fresh ELK layout, each new element is checked against
 * `layerPositionCache` -- a hit means this same recipe key sat on the canvas before a
 * `removeLayerAndRefresh` deleted it, so its old spot is restored instead of a new one being
 * computed, which is what makes remove-then-re-add via the rail keep a user's dragged layout. */

/** Whether a recipe run's ids belong to a hard-layout layer — a structure the canvas never
 * user-drags (epics columns, sequence participants/messages), so a refresh re-runs its whole
 * deterministic layout instead of only the brand-new elements. Reads `BLOCK_RULES[render].lockedLayout`
 * (the single source of truth for "hard layout": a stale sequence column re-spreads, a future locked
 * kind picks this up from its own flag, not another `||` clause here). `render === "group"` is folded
 * in explicitly: an epics frame is a hard, non-draggable shell (its own `add_group` op, no
 * `lockedLayout` since it isn't a node-box), so a run that reconciles only group shells still counts —
 * matching the original `isEpicsLayer`'s epic-or-group gate. */
function isHardLayoutLayer(doc: CanvasDoc, ids: readonly string[]): boolean {
  return ids.some((id) => {
    const element = doc.elements[id];
    return Boolean(
      element && (BLOCK_RULES[element.render].lockedLayout || element.render === "group"),
    );
  });
}

export async function runRecipeAndLayout(
  engineClient: EngineClient,
  name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Withhold this layer's transient (0,0) snapshot (the recipe's own commit broadcasts it before
  // the layout pass below has run) so the canvas never flashes the pile -- fetchAndApplyCanvasDoc
  // holds off on any snapshot while at least one layer is mid-layout, and releaseLayout below
  // releases it once the laid-out positions are committed.
  canvasDocStore.deferLayout(name);
  try {
    const result = await engineClient.runRecipe(name);
    if (!result.ok) {
      return { ok: false, error: result.errors[0]?.message ?? "recipe run failed" };
    }
    // Soft: the batch already committed, so this only records what to say beside the drawn diagram.
    diagramHealthStore.set(name, result.diagnostics);
    const doc = await engineClient.getCanvas();
    const newIds = Object.values(result.id_map).filter((id) => doc.elements[id]);
    // A hard-layout layer (epics or sequence) is never user-dragged, so a refresh re-arranges its
    // whole structure rather than only the brand-new boxes -- otherwise an already-placed layer would
    // keep stale positions (a sequence layer drawn before a colW change keeps its old narrow columns)
    // and never pick up the current deterministic layout. Other layers keep the "only new elements"
    // rule so a refresh never moves a box the user dragged.
    const hardLayout = doc && isHardLayoutLayer(doc, newIds) ? true : false;
    const layoutIds = hardLayout
      ? Object.values(doc.elements)
          .filter((element) => element.layer === name)
          .map((element) => element.id)
      : newIds;
    const restored: Record<string, CanvasPosition> = {};
    const toLayout: string[] = [];
    for (const id of layoutIds) {
      const element = doc.elements[id];
      const recipeKey = element ? recipeChromeKey(element) : "";
      const cached = recipeKey ? takeCachedPosition(name, recipeKey) : undefined;
      if (cached) restored[id] = cached;
      else toLayout.push(id);
    }
    const { positions, sizes } = await layoutNewElements(doc, toLayout, restored);
    // Fold any derived sizes (a content-fit epics width) in with the positions; `update_element`
    // carries both, so a box that auto-sized to its text keeps that width once persisted.
    const layout = { ...restored, ...positions };
    const ops = Object.entries(layout).map(([id, position]) => ({
      op: "update_element" as const,
      id,
      position,
      ...(sizes?.[id] ? { size: sizes[id] } : {}),
    }));
    if (ops.length > 0) {
      // patchCanvasDoc's own post-write refetch applies the laid-out doc through the shared
      // fetchAndApplyCanvasDoc path: the content check there passes now that these boxes are no
      // longer origin-piled, so the canvas shows the finished spread in one step.
      await patchCanvasDoc(engineClient, ops, {
        layer: name,
        explanation: "auto-layout new elements",
      });
    }
    return { ok: true };
  } finally {
    // Release just this withheld layer; its layout PATCH has committed by now, so its next snapshot
    // (already applied above, or the existing doc if there was nothing to lay out) is the real one.
    // Per-layer so a concurrent layout for another layer stays withheld until it finishes too.
    canvasDocStore.releaseLayout(name);
  }
}

/** Deletes every element (and any edge tagged with `layer` that survives that cascade — see
 * apply_batch.py's `_apply_delete_element`, which already drops an edge once either endpoint is
 * gone) so a diagram removed from the canvas comes off outright — the underlying artifact on disk is
 * untouched, so `runRecipeAndLayout` can bring it straight back with no redraw (this is what
 * `AgentRail`'s Diagrams tab now offers as its own "remove from canvas" row action, replacing
 * `RecipeMenu`'s old click-to-toggle). `confirmMassDelete` is always on: the click that reaches this
 * function already IS the user's confirmation, and a real diagram routinely exceeds apply_batch's
 * unconfirmed mass-delete guard.
 *
 * Snapshots every element's position into `layerPositionCache` first — once `delete_element` lands,
 * that position exists nowhere else, and `runRecipeAndLayout` reads this snapshot to restore it if
 * the same recipe is picked again instead of running a fresh ELK layout. */
export async function removeLayerAndRefresh(
  engineClient: EngineClient,
  layer: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const doc = canvasDocStore.getDoc();
  const layerElements = Object.values(doc.elements).filter((element) => element.layer === layer);
  captureLayerPositions(layerElements, layer);
  const elementIds = layerElements.map((element) => element.id);
  const deleting = new Set(elementIds);
  const strayEdgeIds = Object.values(doc.edges)
    .filter((edge) => edge.layer === layer && !deleting.has(edge.from) && !deleting.has(edge.to))
    .map((edge) => edge.id);
  const ops: CanvasOp[] = [
    ...elementIds.map((id): CanvasOp => ({ op: "delete_element", id })),
    ...strayEdgeIds.map((id): CanvasOp => ({ op: "delete_edge", id })),
  ];
  // The warning described a diagram that is going away; keeping it would describe nothing.
  diagramHealthStore.clear(layer);
  if (ops.length === 0) return { ok: true };
  const result = await patchCanvasDoc(engineClient, ops, {
    layer,
    explanation: "remove diagram",
    confirmMassDelete: true,
  });
  if (!result.ok) return { ok: false, error: result.errors[0]?.message ?? "remove failed" };
  return { ok: true };
}

/** The rail's own delete action -- unlike `removeLayerAndRefresh` above (canvas-only, no
 * confirmation needed because the click that reaches it already IS one), this is reached through a
 * real confirm dialog and also deletes the diagram's on-disk artifact so it doesn't just come back
 * next time something regenerates it. File first, canvas second: if the file-delete fails nothing
 * else happened yet, so the row stays put and a retry is safe; if it succeeds but the canvas PATCH
 * then fails, the row stays visible (its layer is still on the canvas) and a retried file-delete on
 * an already-gone file just resolves `{deleted: false}`, not an error, so the retry still works. */
export async function deleteDiagramAndRefresh(
  engineClient: EngineClient,
  layer: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (hasDeletableDiagramArtifact(layer)) {
    try {
      await engineClient.deleteDiagram(layer);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "delete failed" };
    }
  }
  return removeLayerAndRefresh(engineClient, layer);
}
