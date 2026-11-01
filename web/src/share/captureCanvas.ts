import { toBlob, toSvg } from "html-to-image";

const PADDING = 32;
const MAX_SIDE = 12000;
const MAX_PIXELS = 100_000_000;

/** WebKit (macOS WebView, Safari) paints a foreignObject snapshot blank until its fonts and images have loaded once. */
function isWebKit(): boolean {
  return /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent);
}

export interface CanvasCapture {
  width: number;
  height: number;
  background: string;
  /** Rasterize the whole diagram to a PNG. */
  png(): Promise<Blob>;
  /** The whole diagram as a self-contained SVG data URL (HTML boxes inlined via foreignObject). */
  svgDataUrl(): Promise<string>;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The nodes that define the export extent: every child, or only the given diagrams' tagged nodes. */
function boundsSources(content: HTMLElement, layers?: ReadonlySet<string>): Element[] {
  if (!layers) return Array.from(content.children);
  return Array.from(content.querySelectorAll("[data-layer]")).filter((el) =>
    layers.has(el.getAttribute("data-layer") ?? ""),
  );
}

/** The union of the content's children (or of the chosen diagrams) in the content's own (un-panned, un-zoomed) coordinates. */
export function contentBounds(content: HTMLElement, layers?: ReadonlySet<string>): Bounds | null {
  const viewport = content.parentElement;
  if (!viewport) return null;
  const matrix = new DOMMatrixReadOnly(getComputedStyle(content).transform);
  const scale = matrix.a || 1;
  const origin = viewport.getBoundingClientRect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of boundsSources(content, layers)) {
    const rect = child.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    minX = Math.min(minX, (rect.left - origin.left - matrix.e) / scale);
    minY = Math.min(minY, (rect.top - origin.top - matrix.f) / scale);
    maxX = Math.max(maxX, (rect.right - origin.left - matrix.e) / scale);
    maxY = Math.max(maxY, (rect.bottom - origin.top - matrix.f) / scale);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Prepares a capture of the canvas content (only the given diagram layers when set), or null when there is nothing to export. */
export function prepareCapture(
  root: Document = document,
  layerList?: readonly string[],
): CanvasCapture | null {
  const layers = layerList ? new Set(layerList) : undefined;
  const content = root.querySelector<HTMLElement>('[data-testid="canvas-content"]');
  const viewport = content?.parentElement;
  if (!content || !viewport) return null;
  const bounds = contentBounds(content, layers);
  if (!bounds) return null;
  const naturalWidth = bounds.width + PADDING * 2;
  const naturalHeight = bounds.height + PADDING * 2;
  const fit = Math.min(1, MAX_SIDE / Math.max(naturalWidth, naturalHeight));
  const width = Math.ceil(naturalWidth * fit);
  const height = Math.ceil(naturalHeight * fit);
  const computed = getComputedStyle(viewport).backgroundColor;
  const background = computed === "rgba(0, 0, 0, 0)" ? "#11131a" : computed;
  const options = {
    width,
    height,
    pixelRatio: Math.min(2, Math.sqrt(MAX_PIXELS / (width * height))),
    backgroundColor: background,
    filter: (node: Node) => {
      if (!layers || !(node instanceof Element)) return true;
      const layer = node.getAttribute("data-layer");
      return layer === null || layers.has(layer);
    },
    style: {
      transform: `scale(${fit}) translate(${PADDING - bounds.x}px, ${PADDING - bounds.y}px)`,
      transformOrigin: "0 0",
      transition: "none",
    },
  };
  const warmUp = async () => {
    if (isWebKit()) await toSvg(content, options).catch(() => undefined);
  };
  return {
    width,
    height,
    background,
    async png() {
      await warmUp();
      const blob = await toBlob(content, options);
      if (!blob) throw new Error("The diagram could not be rendered");
      return blob;
    },
    async svgDataUrl() {
      await warmUp();
      return toSvg(content, options);
    },
  };
}
