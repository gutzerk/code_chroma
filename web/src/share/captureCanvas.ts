import { toBlob, toSvg } from "html-to-image";

const PADDING = 32;
const MAX_SIDE = 12000;
const MAX_PIXELS = 100_000_000;

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

/** The union of the content's children in the content's own (un-panned, un-zoomed) coordinates. */
export function contentBounds(content: HTMLElement): Bounds | null {
  const viewport = content.parentElement;
  if (!viewport) return null;
  const matrix = new DOMMatrixReadOnly(getComputedStyle(content).transform);
  const scale = matrix.a || 1;
  const origin = viewport.getBoundingClientRect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of Array.from(content.children)) {
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

/** Prepares a whole-diagram capture of the canvas content, or null when there is nothing to export. */
export function prepareCapture(root: Document = document): CanvasCapture | null {
  const content = root.querySelector<HTMLElement>('[data-testid="canvas-content"]');
  const viewport = content?.parentElement;
  if (!content || !viewport) return null;
  const bounds = contentBounds(content);
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
    style: {
      transform: `scale(${fit}) translate(${PADDING - bounds.x}px, ${PADDING - bounds.y}px)`,
      transformOrigin: "0 0",
      transition: "none",
    },
  };
  return {
    width,
    height,
    background,
    async png() {
      const blob = await toBlob(content, options);
      if (!blob) throw new Error("The diagram could not be rendered");
      return blob;
    },
    svgDataUrl: () => toSvg(content, options),
  };
}
