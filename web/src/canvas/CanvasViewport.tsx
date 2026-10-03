import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { canvasLayoutStore } from "../state/canvasLayoutStore";
import { selectionStore } from "../state/selectionStore";
import { gridStep } from "./canvasGrid";
import { clamp } from "../util/clamp";
import { readSavedCameraView, writeSavedCameraView } from "./canvasCameraStore";

export interface CanvasViewportHandle {
  /** Returns false, without moving the camera, when `nodeId` isn't mounted yet — callers that need
   * the camera to end up centered (not just "tried once") retry off this. */
  centerOnNode: (nodeId: string) => boolean;
  focusOnNode: (nodeId: string) => void;
  fitToNode: (nodeId: string) => void;
  /** Fits the union of the given nodes' boxes. Returns true only once EVERY id was found in the
   * DOM (callers reveal nodes whose blocks mount asynchronously, so they retry until this is true). */
  fitToNodes: (nodeIds: string[]) => boolean;
  /** Fits the union of every mounted node, whatever is on the canvas — see the imperative handle. */
  fitToAllNodes: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

interface CanvasViewportProps {
  children: ReactNode;
}

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

/** The reset camera position ("Fit-wise origin"): no pan, no zoom — what the canvas opens on when
 * nothing was saved, and what resetView() returns to. Used as the fallback when a reload has no
 * persisted view to restore. */
const RESET_VIEW: ViewState = { x: 0, y: 0, scale: 1 };

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const BUTTON_ZOOM_STEP = 1.12;

// A "focus this block" action needs to zoom in further than manual wheel/button zoom ever does (a
// deeply-nested block can be a tiny fraction of the viewport), so it gets its own ceiling — capped
// well short of MAX_SCALE so even a tiny nested block never zooms in uncomfortably close.
const FOCUS_MAX_SCALE = 3.5;
const FOCUS_FIT_PADDING = 0.7;
const FOCUS_ANIMATION_MS = 550;

// How long the viewport must stay still (no resize) before recentering re-arms. Recentering is
// debounced onto this settle so the viewport's startup settle-shrink (side panels mounting a beat
// after the camera restore, on a reload) doesn't re-center the saved camera — see the effect below.
const VIEW_SETTLE_MS = 300;

// Consecutive frames the framed layout must stay unchanged before fitToNodes reports "done" — long
// enough to outlast the lazy-load reflow that follows the last block mounting, short enough to be
// imperceptible. See fitToNodes for why "all present" alone isn't a safe stop condition.
const FIT_SETTLE_FRAMES = 2;

/** Solves for the scale/translate that makes `targetRect` fill `viewportRect`, centered — undoing
 * the current transform (via `v`) first to work in untransformed (logical) coordinates. */
function computeFitView(v: ViewState, viewportRect: DOMRect, targetRect: DOMRect): ViewState {
  const logicalWidth = targetRect.width / v.scale;
  const logicalHeight = targetRect.height / v.scale;
  const logicalCenterX = (targetRect.left - viewportRect.left - v.x) / v.scale + logicalWidth / 2;
  const logicalCenterY = (targetRect.top - viewportRect.top - v.y) / v.scale + logicalHeight / 2;

  const fitScale = Math.min(viewportRect.width / logicalWidth, viewportRect.height / logicalHeight);
  const newScale = clamp(fitScale * FOCUS_FIT_PADDING, MIN_SCALE, FOCUS_MAX_SCALE);

  return {
    x: viewportRect.width / 2 - logicalCenterX * newScale,
    y: viewportRect.height / 2 - logicalCenterY * newScale,
    scale: newScale,
  };
}

/** A shown inline code/diff panel can visually overflow its own block: the block sits in a CSS
 * Grid track sized via `minmax(240px, max-content)`, but that track can get stuck at its 240px
 * floor once the block flips to a flex-row layout with the panel beside it (a CSS Grid intrinsic-
 * sizing quirk — the grid doesn't grow the column to fit the panel, so the panel spills outside
 * its own block's box with nothing clipping it). The block's own rect is therefore not reliable
 * once its code is visible; union in the panel's rect too (which IS sized correctly, since its
 * width comes directly from its own CSS rather than an ancestor grid track) so fitting/focusing
 * actually captures what's really on screen instead of a stale, too-small box. */
function expandForInlineCodePanel(targetEl: HTMLElement, targetRect: DOMRect): DOMRect {
  // Scoped to :scope > so this only ever picks up targetEl's OWN panel (CodeView/DiffView is
  // always rendered as a direct child of the block div, sibling to .block-header) — an
  // unscoped querySelector would also match a panel open on some unrelated, arbitrarily deep
  // descendant whenever targetEl is an ancestor being fit (e.g. clicking "Fit All", or any
  // expand/collapse auto-fit), unioning in a rect that has nothing to do with this node and can
  // wildly distort the computed zoom/pan.
  const panelEl = targetEl.querySelector<HTMLElement>(
    ':scope > [data-testid="block-code-view"], :scope > [data-testid="diff-view"]',
  );
  if (!panelEl) return targetRect;
  const panelRect = panelEl.getBoundingClientRect();
  const left = Math.min(targetRect.left, panelRect.left);
  const top = Math.min(targetRect.top, panelRect.top);
  const right = Math.max(targetRect.right, panelRect.right);
  const bottom = Math.max(targetRect.bottom, panelRect.bottom);
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Unions every element's on-screen rect (each grown by its OWN inline code/diff panel) into one box,
 * skipping the not-yet-laid-out ones — so framing several blocks at once captures all of them. */
function unionRects(elements: Iterable<HTMLElement>): { rect: DOMRect | null; found: number } {
  let rect: DOMRect | null = null;
  let found = 0;
  for (const element of elements) {
    const elementRect = element.getBoundingClientRect();
    if (elementRect.width === 0 || elementRect.height === 0) continue;
    found += 1;
    const expanded = expandForInlineCodePanel(element, elementRect);
    if (!rect) {
      rect = expanded;
      continue;
    }
    const left = Math.min(rect.left, expanded.left);
    const top = Math.min(rect.top, expanded.top);
    const right = Math.max(rect.right, expanded.right);
    const bottom = Math.max(rect.bottom, expanded.bottom);
    rect = new DOMRect(left, top, right - left, bottom - top);
  }
  return { rect, found };
}

interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  // A pan only actually starts once the pointer moves past PAN_THRESHOLD — until then this is a
  // pending gesture that might still turn out to be a plain click (block expand/collapse toggle).
  active: boolean;
}

interface MarqueeState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  // Same pending-until-threshold convention as PanState — a shift-click that never moves past
  // PAN_THRESHOLD is a plain (modifier) click on whatever's underneath, not a marquee.
  active: boolean;
  // The selection as it stood before this marquee gesture started — captured once at pointerdown so
  // the live preview can extend it every frame (addMany semantics) without the previous frame's
  // preview matches leaking in as a false "already selected" baseline.
  baseSelection: string[];
}

/** A marquee rectangle, in client (screen) coordinates — the same space `getBoundingClientRect()`
 * reports for every candidate node, so hit-testing needs no pan/zoom conversion. */
interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function rectsIntersect(a: MarqueeRect, b: DOMRect): boolean {
  return a.left < b.right && a.left + a.width > b.left && a.top < b.bottom && a.top + a.height > b.top;
}

// Shared by the live preview (every rAF while dragging) and the final commit on release — same
// `data-select-id` convention as the rest of the marquee (see endMarquee's own comment on why not
// `data-node-id`).
function findMarqueeMatches(viewportEl: HTMLElement, rect: MarqueeRect): string[] {
  const matches: string[] = [];
  viewportEl.querySelectorAll<HTMLElement>("[data-select-id]").forEach((el) => {
    const selectId = el.getAttribute("data-select-id");
    if (selectId && rectsIntersect(rect, el.getBoundingClientRect())) matches.push(selectId);
  });
  return matches;
}

// Pointer travel (px) before a press-and-hold becomes a pan rather than a click. Big enough to
// absorb the incidental jitter browsers report on an ordinary click, small enough to feel instant.
const PAN_THRESHOLD = 4;

// Controls that own the raw pointer and must never trigger a pan: buttons, and the draggable/
// resizable code, diff, plan, and C1 change-review panels (their headers reposition them, their
// bodies select text). Everything else — empty block padding, headers, the bare canvas — is fair
// game for panning. Exported for the C1 view, whose draggable box anchors must yield to the same
// controls.
export const PAN_IGNORE_SELECTOR =
  'button, [data-testid="block-code-view"], [data-testid="diff-view"], [data-testid="plan-panel"], [data-testid="c1-change-panel"], [data-testid="c1-change-summary"]';

// A relationship arrow's wide invisible hit-stroke (RelationshipEdge's own `.c1-relationship-hit`,
// 14px so a 1.5px line is actually hoverable) sits at a higher z-index than every box so it's never
// visually hidden where it crosses one -- but that means it also wins pointer hit-testing there, so a
// click meant for the box underneath lands on the arrow instead and silently does nothing. Only a
// dense multi-layer canvas (many boxes, many routed edges packed close together) makes this common
// enough to notice; a lone diagram rarely has an edge crossing this close to a box. Every box type's
// own real click target, in priority order (canvas-doc boxes only wire onClick on their inner header,
// not the outer element the way a hierarchy Block/TreeNode does).
const REDIRECTABLE_CLICK_SELECTOR =
  '[data-testid="canvas-node-box-header"], [data-testid="block"], [data-testid="tree-node"]';

/** Finds the real clickable box under an arrow's hit-stroke by walking the full hit-test stack at
 * that point (not just `elementFromPoint`'s single topmost hit) -- the box is still there, just
 * beneath the arrow in stacking order, not covered by it. */
function clickTargetBelowArrow(clientX: number, clientY: number): HTMLElement | null {
  if (typeof document.elementsFromPoint !== "function") return null;
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const match = (el as HTMLElement).closest?.(REDIRECTABLE_CLICK_SELECTOR);
    if (match) return match as HTMLElement;
  }
  return null;
}

/** Miro-style zoom/pan wrapper around the strategy's rendered nodes: scroll-wheel zooms toward the
 * cursor, and dragging the canvas pans — both via a CSS transform on `.canvas-content`, never by
 * hiding or repositioning individual nodes. A pan starts anywhere the pointer isn't on a genuine
 * control (PAN_IGNORE_SELECTOR) and only once it actually moves past PAN_THRESHOLD, so the large
 * empty areas inside expanded (and inline-code) blocks pan while a plain click still toggles the
 * block under it. The click a completed drag would synthesize is swallowed so it can't also toggle. */
export const CanvasViewport = forwardRef<CanvasViewportHandle, CanvasViewportProps>(
  function CanvasViewport({ children }, ref) {
    // Restore the persisted camera at mount (lazy initializer so localStorage is read once). Reset
    // to the fresh origin when nothing is saved -- readSavedCameraView returns null for an absent
    // or at-origin view.
    const [view, setView] = useState<ViewState>(() => readSavedCameraView() ?? RESET_VIEW);
    const [isFocusing, setIsFocusing] = useState(false);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const panRef = useRef<PanState | null>(null);
    const marqueeRef = useRef<MarqueeState | null>(null);
    const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
    // rAF-coalesces the live hit-test below (same pattern as the ResizeObserver bump further down)
    // so a burst of raw pointermove events runs the querySelectorAll/intersect pass once per frame,
    // not once per event. marqueeRectRef always holds the latest rect so the frame that actually
    // fires hit-tests against where the pointer is NOW, not where it was when the frame was queued.
    const marqueeRafRef = useRef<number | null>(null);
    const marqueeRectRef = useRef<MarqueeRect | null>(null);
    // Set when a drag just ended, so the click it synthesizes gets swallowed (see onClickCapture)
    // instead of also toggling the block the pan happened to end over. Shared by pan and marquee —
    // only one of the two is ever active per gesture.
    const didPanRef = useRef(false);
    const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Remembers which node the last focusOnNode() call zoomed into, and what the view looked like
    // right before that — so clicking the same node's focus button again toggles back instead of
    // recomputing the same fit.
    const lastFocusedNodeIdRef = useRef<string | null>(null);
    const previousViewRef = useRef<ViewState | null>(null);
    // fitToNodes is called every frame by callers reveal-then-fit loops. It reports "done" only once
    // the framed set is both fully present AND its measured extent has stopped changing across
    // frames — otherwise the loop stops the instant every block first mounts, before lazily-loaded
    // rows finish flowing in and growing the tree, freezing the camera on a too-short rect (the tree
    // then sits below/right of center). Keyed per node-id set: two concurrent fit loops (the camera
    // hook's and a diagram view's) used to share one signature slot and reset each other's count.
    const fitSettleStateRef = useRef(new Map<string, { rect: string; stableFrames: number }>());

    // A pending 550ms focus timeout must not fire setState on an unmounted viewport.
    useEffect(
      () => () => {
        if (focusTimeoutRef.current !== null) clearTimeout(focusTimeoutRef.current);
      },
      [],
    );

    function cancelFocusAnimation() {
      if (focusTimeoutRef.current !== null) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
      setIsFocusing(false);
    }

    function playFocusAnimation() {
      setIsFocusing(true);
      if (focusTimeoutRef.current !== null) clearTimeout(focusTimeoutRef.current);
      focusTimeoutRef.current = setTimeout(() => {
        focusTimeoutRef.current = null;
        setIsFocusing(false);
      }, FOCUS_ANIMATION_MS);
    }

    function zoomAround(cursorX: number, cursorY: number, factor: number) {
      setView((v) => {
        const newScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
        const newX = cursorX - ((cursorX - v.x) / v.scale) * newScale;
        const newY = cursorY - ((cursorY - v.y) / v.scale) * newScale;
        return { x: newX, y: newY, scale: newScale };
      });
    }

    function viewportCenter(): { x: number; y: number } {
      const rect = viewportRef.current?.getBoundingClientRect();
      return { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
    }

    function locateNodeRects(nodeId: string): { viewportRect: DOMRect; targetRect: DOMRect } | null {
      const viewportEl = viewportRef.current;
      const targetEl = viewportEl?.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(nodeId)}"]`,
      );
      if (!viewportEl || !targetEl) return null;
      // computeFitView divides the measured targetRect by the current `view.scale` to get
      // logical coordinates — an assumption that only holds if the DOM is actually painted at
      // exactly that scale. If a previous focus/fit's 550ms CSS transition is still interpolating
      // (e.g. showing a block's inline code right after the expand that revealed it triggered its
      // own auto-fit), `view.scale` is already the fully-committed target value but the on-screen
      // transform is still mid-animation — measuring against that stale visual position while
      // dividing by the already-final scale produces a wildly wrong result (observed: snapping to
      // the max zoom ceiling instead of fitting). Stripping the transition class here forces the
      // browser to resolve the transform to `view`'s current committed value before we measure;
      // playFocusAnimation() re-adds the class afterwards for the next transition.
      contentRef.current?.classList.remove("canvas-content--animated");
      const viewportRect = viewportEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      if (targetRect.width === 0 || targetRect.height === 0) return null;
      return { viewportRect, targetRect: expandForInlineCodePanel(targetEl, targetRect) };
    }

    useImperativeHandle(ref, () => ({
      centerOnNode(nodeId: string) {
        // Same measurement primitive as focusOnNode/fitToNode/fitToNodes: strips the in-flight
        // `canvas-content--animated` transition class before reading rects, for the reason
        // documented on locateNodeRects — a mid-transition read produces an interpolated, not
        // settled, position/size.
        const rects = locateNodeRects(nodeId);
        if (!rects) return false;
        const { viewportRect, targetRect } = rects;
        const currentCenterX = targetRect.left + targetRect.width / 2 - viewportRect.left;
        const currentCenterY = targetRect.top + targetRect.height / 2 - viewportRect.top;
        const targetCenterX = viewportRect.width / 2;
        const targetCenterY = viewportRect.height / 2;
        setView((v) => ({
          ...v,
          x: v.x + (targetCenterX - currentCenterX),
          y: v.y + (targetCenterY - currentCenterY),
        }));
        return true;
      },
      focusOnNode(nodeId: string) {
        // Clicking the same node's focus button again toggles back to wherever the view was
        // right before it was focused, instead of recomputing the same fit.
        if (lastFocusedNodeIdRef.current === nodeId && previousViewRef.current) {
          const restoreView = previousViewRef.current;
          lastFocusedNodeIdRef.current = null;
          previousViewRef.current = null;
          setView(restoreView);
          playFocusAnimation();
          return;
        }

        const rects = locateNodeRects(nodeId);
        if (!rects) return;

        previousViewRef.current = view;
        lastFocusedNodeIdRef.current = nodeId;

        setView((v) => computeFitView(v, rects.viewportRect, rects.targetRect));
        playFocusAnimation();
      },
      fitToNode(nodeId: string) {
        const rects = locateNodeRects(nodeId);
        if (!rects) return;

        // An unconditional re-fit (e.g. "Fit All"), not a toggle — clear any pending per-node
        // toggle memory so a later repeat click on a block's own focus button doesn't restore a
        // now-stale view from before this re-fit happened.
        lastFocusedNodeIdRef.current = null;
        previousViewRef.current = null;

        setView((v) => computeFitView(v, rects.viewportRect, rects.targetRect));
        playFocusAnimation();
      },
      fitToNodes(nodeIds: string[]): boolean {
        const viewportEl = viewportRef.current;
        if (!viewportEl) return false;

        // Same toggle-memory reset as fitToNode — this is an unconditional re-fit, not a per-node
        // focus toggle.
        lastFocusedNodeIdRef.current = null;
        previousViewRef.current = null;

        // Strip the transition class before measuring, for the same reason locateNodeRects does:
        // measure against the committed transform, not a mid-animation position.
        contentRef.current?.classList.remove("canvas-content--animated");
        const viewportRect = viewportEl.getBoundingClientRect();

        // Union every found node's rect into one box, then fit that — so revealing several changed
        // functions at once frames all of them instead of just the last.
        const targets = nodeIds
          .map((nodeId) =>
            viewportEl.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`),
          )
          .filter((el): el is HTMLElement => el !== null);
        const { rect: unionRect, found: foundCount } = unionRects(targets);
        if (!unionRect) return false;

        const fitRect = unionRect;
        setView((v) => computeFitView(v, viewportRect, fitRect));
        playFocusAnimation();

        // Report "done" only when every requested node is present AND the framed rect has held
        // steady for a couple of frames — otherwise a reveal-then-fit loop stops the instant the
        // last block first mounts, before lazily-loaded child rows finish flowing in and growing
        // the tree, leaving the camera fitted to a too-short rect (the tree then sits below/right
        // of center). computeFitView is idempotent, so once the layout stops changing the measured
        // union rect stops changing within a frame — a stable rect across frames is the settle
        // signal. Keyed by nodeIds so a different fit op starts its stability count fresh.
        const allPresent = foundCount === nodeIds.length;
        const key = nodeIds.join(",");
        const rectSignature = `${Math.round(unionRect.left)},${Math.round(
          unionRect.top,
        )},${Math.round(unionRect.width)},${Math.round(unionRect.height)}`;
        const settled = fitSettleStateRef.current;
        const previous = settled.get(key);
        const stableFrames =
          allPresent && previous?.rect === rectSignature ? previous.stableFrames + 1 : 0;
        // Bounded: distinct fits accumulate per session, so trim before the map can grow unchecked.
        if (!settled.has(key) && settled.size >= 32) settled.clear();
        settled.set(key, { rect: rectSignature, stableFrames });
        return allPresent && stableFrames >= FIT_SETTLE_FRAMES;
      },
      // "Fit All" — deliberately id-free, because there is no single element that encloses the whole
      // canvas in every view. In the hierarchy the root block nests its descendants, so fitting root
      // was enough; the C1 view instead renders absolutely-positioned box anchors under a
      // `display: contents` wrapper, so there is nothing to measure and fitting root (not rendered at
      // all there) silently did nothing. Unioning whatever carries a data-node-id covers both —
      // but only elements with a real node_id: the single-canvas doc also renders note/group/diagram
      // frames and synthetic boxes (node_id null) that carry no data-node-id, so fit-all used to
      // collapse onto whichever diagram happened to have code-backed boxes. Every canvas-doc element
      // itself now stamps `data-canvas-element`, so unioning that PLUS data-node-id covers the whole
      // canvas in both the hierarchy and the one-canvas doc.
      fitToAllNodes() {
        const viewportEl = viewportRef.current;
        if (!viewportEl) return;

        // Same toggle-memory reset and transition-class strip as fitToNode/fitToNodes.
        lastFocusedNodeIdRef.current = null;
        previousViewRef.current = null;
        contentRef.current?.classList.remove("canvas-content--animated");
        const viewportRect = viewportEl.getBoundingClientRect();

        // Scoped to the viewport, not the document: the Explorer tree stamps data-node-id too, and
        // it lives outside the pannable canvas entirely. data-canvas-element covers every canvas-doc
        // box/area (notes, groups, synthetic without node_id); data-node-id covers the hierarchy's
        // Block/TreeNode plus any code-backed box that also carries it.
        const { rect: unionRect } = unionRects(
          viewportEl.querySelectorAll<HTMLElement>(
            "[data-canvas-element], [data-node-id]",
          ),
        );
        if (!unionRect) return;

        setView((v) => computeFitView(v, viewportRect, unionRect));
        playFocusAnimation();
      },
      zoomIn() {
        const { x, y } = viewportCenter();
        zoomAround(x, y, BUTTON_ZOOM_STEP);
      },
      zoomOut() {
        const { x, y } = viewportCenter();
        zoomAround(x, y, 1 / BUTTON_ZOOM_STEP);
      },
      resetView() {
        setView(RESET_VIEW);
      },
    }));

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      cancelFocusAnimation();
      // A mouse's horizontal scroll wheel (or a shift+scroll) reports deltaX — treat it as a
      // sideways pan rather than a zoom, since deltaY already owns zoom-toward-cursor below.
      // Sign matches native scroll containers: scrolling right (positive deltaX) slides content
      // left, i.e. subtracts from view.x — the opposite of drag-to-pan's additive dx.
      if (e.deltaX !== 0) {
        setView((v) => ({ ...v, x: v.x - e.deltaX }));
      }
      if (e.deltaY !== 0) {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        zoomAround(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0128));
      }
    }

    // Wired natively (not via JSX onWheel) because React delegates wheel events through a passive
    // root listener, silently no-op-ing preventDefault() — without this, Ctrl+scroll / trackpad
    // pinch would still trigger the browser's own native page zoom alongside this handler's zoom,
    // dragging every "fixed" screen element (top chrome, Fit All) along with it. Safari
    // doesn't represent trackpad pinch as wheel+ctrlKey at all — it fires its own non-standard
    // gesture events instead, so those are suppressed here too (canvas zoom on Safari still works
    // via ordinary two-finger scroll, which Safari does report as a wheel event).
    useEffect(() => {
      const el = viewportRef.current;
      if (!el) return;
      const preventGestureDefault = (e: Event) => e.preventDefault();
      el.addEventListener("wheel", handleWheel, { passive: false });
      el.addEventListener("gesturestart", preventGestureDefault, { passive: false });
      el.addEventListener("gesturechange", preventGestureDefault, { passive: false });
      el.addEventListener("gestureend", preventGestureDefault, { passive: false });
      return () => {
        el.removeEventListener("wheel", handleWheel);
        el.removeEventListener("gesturestart", preventGestureDefault);
        el.removeEventListener("gesturechange", preventGestureDefault);
        el.removeEventListener("gestureend", preventGestureDefault);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep content centered in the visible canvas when the viewport's own size changes — chiefly a
    // side panel opening or growing, which shrinks .canvas-area and would otherwise slide open blocks
    // out of sight under the panel (forcing a manual "Fit All" to recover them). Content is anchored
    // at left:0/top:0 and the viewport's top-left corner is fixed, so its center moves by delta/2 on
    // each axis — panning by delta/2 keeps content centered, preserving zoom (unlike a re-fit).
    // Both axes matter: the inspector shrinks the canvas from the right, the terminal (now a bottom
    // dock) from the bottom.
    //
    // Not every width change is a real window/panel resize: on a reload that restores a saved camera,
    // the side panels (project tree + code sidebar) mount a frame or two AFTER the viewport — so the
    // viewport briefly paints at full width, then shrinks to its final width once the panels land. The
    // saved camera was written for the final layout (panels present), so that settle-shrink must not
    // re-center the view or it shifts the restored camera sideways on every reload (the accumulated
    // ~-125px drift bug). We arm recentering only once the viewport has gone VIEW_SETTLE_MS without
    // further resize (a debounced settle: any size change — including the panel-mount shrink — defers
    // arming), so a slow settle just keeps resetting the timer instead of racing a fixed wall-clock
    // window off mount. Only then do genuine later resizes (window/panel) re-center.
    const settledRef = useRef(false);
    useEffect(() => {
      const el = viewportRef.current;
      if (!el || typeof ResizeObserver === "undefined") return undefined;
      let last: { width: number; height: number } | null = null;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      const arm = () => {
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
        settledRef.current = true;
      };
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        const width = rect?.width ?? el.clientWidth;
        const height = rect?.height ?? el.clientHeight;
        if (last === null) {
          last = { width, height }; // first observation is the baseline, not a resize
          return;
        }
        const dx = width - last.width;
        const dy = height - last.height;
        last = { width, height };
        if (!settledRef.current) {
          // Any size change (incl. the panel-mount settle-shrink) defers arming until fully still.
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(arm, VIEW_SETTLE_MS);
          return;
        }
        if (dx !== 0 || dy !== 0) {
          setView((v) => ({ ...v, x: v.x + dx / 2, y: v.y + dy / 2 }));
        }
      });
      observer.observe(el);
      // Arm even if the viewport never resizes (e.g. a view with no side panels to mount).
      settleTimer = setTimeout(arm, VIEW_SETTLE_MS);
      return () => {
        if (settleTimer) clearTimeout(settleTimer);
        observer.disconnect();
      };
    }, []);

    // Persist the camera as the user pans/zooms, so a reload restores it (readSavedCameraView at
    // mount). The reset origin isn't a meaningful place to save — restoring "no view" is the same as
    // opening on it — so an at-origin view is skipped; the very first render also computes a view that
    // is just the restore read back out, which save-on-change would write redundantly and is exactly
    // what readSavedCameraView treats as "nothing saved".
    useEffect(() => {
      if (view.x === 0 && view.y === 0 && view.scale === 1) return;
      writeSavedCameraView(view);
    }, [view]);

    // Broadcast "block layout changed" so the SVG overlays (connection lines, plan frames) re-measure
    // their getBoundingClientRect boxes on ANY block resize/move — not just expand/collapse. Blocks
    // grow in normal flow when inline code opens, lazy children mount, or an inline panel resizes,
    // which the overlays' own expand/collapse triggers never see (inline-code visibility lives on a
    // separate store snapshot). `.canvas-content` sizes to fit its content, so any such growth
    // resizes it; the rAF debounce coalesces a burst of reflows into one bump per frame. Only a
    // ResizeObserver is used, never a MutationObserver: the overlays render their SVG paths INTO this
    // same subtree, so observing childList/attributes would fire on every recompute and loop forever —
    // the absolutely-positioned overlays never change this element's size, so ResizeObserver is loop-safe.
    useEffect(() => {
      const el = contentRef.current;
      if (!el || typeof ResizeObserver === "undefined") return undefined;
      let rafId: number | null = null;
      const observer = new ResizeObserver(() => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          canvasLayoutStore.bump();
        });
      });
      observer.observe(el);
      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        observer.disconnect();
      };
    }, []);

    function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.button !== 0) return;
      // Fresh gesture: clear any leftover drag-suppression so it can't swallow this click.
      didPanRef.current = false;
      if ((e.target as HTMLElement).closest(PAN_IGNORE_SELECTOR)) return;
      // A held Shift turns an empty-canvas drag into a marquee selection instead of a pan — a
      // shift-click that never crosses the threshold still falls through as a plain (modifier)
      // click, e.g. toggling a block's own selection membership.
      if (e.shiftKey) {
        marqueeRef.current = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          active: false,
          baseSelection: selectionStore.getSelectedIds(),
        };
        return;
      }
      // Record a *pending* pan but don't capture the pointer or cancel any focus animation yet —
      // both are deferred to the moment the drag actually crosses PAN_THRESHOLD, so a plain click
      // (which never crosses it) still reaches the block's own toggle handler untouched.
      panRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: view.x,
        startY: view.y,
        active: false,
      };
    }

    function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
      const marquee = marqueeRef.current;
      if (marquee && marquee.pointerId === e.pointerId) {
        const dx = e.clientX - marquee.startClientX;
        const dy = e.clientY - marquee.startClientY;
        if (!marquee.active) {
          if (Math.abs(dx) < PAN_THRESHOLD && Math.abs(dy) < PAN_THRESHOLD) return;
          marquee.active = true;
          cancelFocusAnimation();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Environments without pointer capture (e.g. jsdom) — the marquee still works without it.
          }
        }
        const rect: MarqueeRect = {
          left: Math.min(marquee.startClientX, e.clientX),
          top: Math.min(marquee.startClientY, e.clientY),
          width: Math.abs(dx),
          height: Math.abs(dy),
        };
        setMarqueeRect(rect);
        marqueeRectRef.current = rect;
        // Preview the selection live instead of leaving every swept block waiting for release: one
        // hit-test per frame, replacing the selection with base+matches so a block the rectangle
        // drags back off unhighlights again (unioning would only ever grow, never shrink, until drop).
        if (marqueeRafRef.current === null) {
          marqueeRafRef.current = requestAnimationFrame(() => {
            marqueeRafRef.current = null;
            const current = marqueeRef.current;
            const viewportEl = viewportRef.current;
            const latestRect = marqueeRectRef.current;
            if (!current?.active || !viewportEl || !latestRect) return;
            const matches = findMarqueeMatches(viewportEl, latestRect);
            selectionStore.replace([...current.baseSelection, ...matches]);
          });
        }
        return;
      }

      const pan = panRef.current;
      if (!pan || pan.pointerId !== e.pointerId) return;
      const dx = e.clientX - pan.startClientX;
      const dy = e.clientY - pan.startClientY;
      if (!pan.active) {
        if (Math.abs(dx) < PAN_THRESHOLD && Math.abs(dy) < PAN_THRESHOLD) return;
        pan.active = true;
        cancelFocusAnimation();
        // Capture now (not on pointerdown) so a real drag keeps panning even when the pointer
        // leaves the viewport, without a plain tap ever having its click retargeted/swallowed.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Environments without pointer capture (e.g. jsdom) — panning still works without it.
        }
        viewportRef.current?.classList.add("canvas-viewport--panning");
      }
      setView((v) => ({ ...v, x: pan.startX + dx, y: pan.startY + dy }));
    }

    function endPan(e: PointerEvent<HTMLDivElement>) {
      const pan = panRef.current;
      if (!pan || pan.pointerId !== e.pointerId) return;
      if (pan.active) {
        // A real drag just ended — flag the click it synthesizes for suppression so it can't also
        // toggle the block the pan ended over.
        didPanRef.current = true;
        viewportRef.current?.classList.remove("canvas-viewport--panning");
      }
      panRef.current = null;
    }

    function endMarquee(e: PointerEvent<HTMLDivElement>) {
      const marquee = marqueeRef.current;
      if (!marquee || marquee.pointerId !== e.pointerId) return;
      if (marqueeRafRef.current !== null) {
        cancelAnimationFrame(marqueeRafRef.current);
        marqueeRafRef.current = null;
      }
      if (marquee.active) {
        // Same click-suppression convention as a finished pan — the marquee's own release swallows
        // whatever click it would otherwise synthesize under the cursor.
        didPanRef.current = true;
        const viewportEl = viewportRef.current;
        const rect = marqueeRect;
        if (viewportEl && rect) {
          // `data-select-id`, not `data-node-id`: selectionStore keys a box by whatever id its own
          // component actually toggles (CanvasNodeBox uses its canvas-doc element id; the hierarchy's
          // top-level boxes use the engine node id) -- `data-node-id` is a different, focus/fit-only
          // key that's absent entirely on a synthetic C1 System/Actor box. Only a real
          // marquee/group-drag participant renders `data-select-id` at all (see Block.tsx's own
          // `selectable` gate), so nothing else can be swept into a rubber-band selection. Final,
          // unthrottled hit-test at the exact release point — the live preview during the drag ran
          // at most one frame behind.
          const matches = findMarqueeMatches(viewportEl, rect);
          // A marquee only ever starts with Shift held (see handlePointerDown), matching shift-click's
          // add-to-selection semantics — it extends the existing selection rather than replacing it.
          selectionStore.replace([...marquee.baseSelection, ...matches]);
        }
      }
      marqueeRef.current = null;
      marqueeRectRef.current = null;
      setMarqueeRect(null);
    }

    function endGesture(e: PointerEvent<HTMLDivElement>) {
      endPan(e);
      endMarquee(e);
    }

    // Escape clears the active selection from anywhere — mirrors the marquee/shift-click entry
    // points living here rather than scattered per-strategy.
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") selectionStore.clear();
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    function handleClickCapture(e: ReactMouseEvent<HTMLDivElement>) {
      if (didPanRef.current) {
        didPanRef.current = false;
        // Capture phase on the viewport (a block's ancestor) runs before the block's own click
        // handler, so stopping propagation here prevents a drag-ending click from toggling it.
        e.stopPropagation();
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest(".c1-relationship-hit")) {
        const redirectTarget = clickTargetBelowArrow(e.clientX, e.clientY);
        if (redirectTarget) {
          // The arrow's hit-stroke is what the browser actually targeted; the box the user meant to
          // click never sees this event at all unless it's forwarded by hand. Re-dispatching a plain
          // click (not this synthetic one) at the real box lets its own onClick run exactly as if the
          // arrow weren't there, modifier keys included so shift/ctrl-click still toggles selection.
          e.stopPropagation();
          redirectTarget.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              shiftKey: e.shiftKey,
              ctrlKey: e.ctrlKey,
              metaKey: e.metaKey,
            }),
          );
        }
        return;
      }
      // A plain click that landed on nothing selectable/interactive (bare canvas, box padding
      // outside its own click target, a panel/button already excluded from panning) means the user
      // clicked away from whatever was selected -- clear it, same as Escape below. A finished pan or
      // marquee never reaches here (both return early above/via didPanRef).
      if (!target.closest(`${REDIRECTABLE_CLICK_SELECTOR}, [data-select-id], ${PAN_IGNORE_SELECTOR}`)) {
        selectionStore.clear();
      }
    }

    return (
      <div
        ref={viewportRef}
        className="canvas-viewport"
        data-testid="app-canvas"
        // The dot grid is painted by .canvas-viewport rather than by .canvas-content, because the
        // content box is only as large as the blocks in it — a background on it would stop at the
        // tree's edge instead of extending across the whole (infinite) canvas. Tracking the camera by
        // hand is the cost of that: background-position carries the pan, so the dot at the content
        // origin stays exactly under the content origin, and background-size carries the zoom. This
        // is also the only feedback a drag on genuinely empty space produces.
        style={
          {
            "--canvas-grid-size": `${gridStep(view.scale)}px`,
            "--canvas-grid-x": `${view.x}px`,
            "--canvas-grid-y": `${view.y}px`,
          } as CSSProperties
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onClickCapture={handleClickCapture}
      >
        <div
          ref={contentRef}
          className={`canvas-content ${isFocusing ? "canvas-content--animated" : ""}`}
          data-testid="canvas-content"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {children}
        </div>
        {marqueeRect && (
          <div
            className="canvas-marquee"
            data-testid="canvas-marquee"
            style={{
              position: "fixed",
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height,
            }}
          />
        )}
      </div>
    );
  },
);
