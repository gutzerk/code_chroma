import { useSyncExternalStore } from "react";
import { Store } from "../state/createStore";
import { clamp } from "../util/clamp";

export type CanvasTexture = "none" | "dots" | "lines";

export interface CanvasStyle {
  bg: string;
  texture: CanvasTexture;
  textureColor: string;
  opacity: number;
  spacing: number;
}

export interface CanvasStylePreset extends CanvasStyle {
  id: string;
  name: string;
}

export const CANVAS_STYLE_DEFAULT: CanvasStyle = {
  bg: "#0b1a2a",
  texture: "none",
  textureColor: "#294766",
  opacity: 20,
  spacing: 24,
};

export const CANVAS_STYLE_PRESETS: readonly CanvasStylePreset[] = [
  { id: "blueprint", name: "Blueprint", bg: "#0b1a2a", texture: "lines", textureColor: "#294766", opacity: 20, spacing: 32 },
  { id: "navy", name: "Deep navy", bg: "#070c1a", texture: "dots", textureColor: "#4a5c93", opacity: 30, spacing: 24 },
  { id: "contrast", name: "High contrast", bg: "#000000", texture: "lines", textureColor: "#ffffff", opacity: 14, spacing: 40 },
  { id: "ice", name: "Nordic ice", bg: "#16222e", texture: "dots", textureColor: "#8db4d2", opacity: 30, spacing: 20 },
  { id: "dusk", name: "Warm dusk", bg: "#241a22", texture: "dots", textureColor: "#a8707f", opacity: 28, spacing: 24 },
  { id: "mono", name: "Monochrome", bg: "#17181a", texture: "lines", textureColor: "#5a5e64", opacity: 22, spacing: 32 },
];

const STORAGE_KEY = "codechroma.canvasStyle";
const LIGHT_LUMINANCE = 0.18;

/** Accepts #rgb or #rrggbb (hash optional) and returns lowercase #rrggbb, or null when invalid. */
export function normalizeHex(raw: string): string | null {
  let text = raw.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(text)) text = text.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(text) ? `#${text.toLowerCase()}` : null;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

export function isLightBackground(hex: string): boolean {
  return luminance(hex) > LIGHT_LUMINANCE;
}

export function sameStyle(a: CanvasStyle, b: CanvasStyle): boolean {
  return (
    a.bg === b.bg &&
    a.texture === b.texture &&
    a.textureColor === b.textureColor &&
    a.opacity === b.opacity &&
    a.spacing === b.spacing
  );
}

/** A preset's style fields without its id and name. */
export function toStyle({ bg, texture, textureColor, opacity, spacing }: CanvasStyle): CanvasStyle {
  return { bg, texture, textureColor, opacity, spacing };
}

export function matchPreset(style: CanvasStyle): CanvasStylePreset | undefined {
  return CANVAS_STYLE_PRESETS.find((p) => sameStyle(p, style));
}

/** The CSS background-image for a texture at the given alpha and dot radius (px); "none" paints nothing. */
export function textureImage(texture: CanvasTexture, color: string, alpha: number, radius: number): string {
  if (texture === "dots") {
    return `radial-gradient(circle at 50% 50%, ${hexToRgba(color, alpha)} ${radius}px, rgba(0,0,0,0) ${radius + 0.6}px)`;
  }
  if (texture === "lines") {
    const c = hexToRgba(color, alpha);
    return `linear-gradient(to right, ${c} 1px, rgba(0,0,0,0) 1px), linear-gradient(to bottom, ${c} 1px, rgba(0,0,0,0) 1px)`;
  }
  return "none";
}

/** The viewport's texture layer for a saved style (the grid size and pan phase come from CanvasViewport's vars). */
export function viewportTextureImage(style: CanvasStyle): string {
  return textureImage(style.texture, style.textureColor, style.opacity / 100, 1.3);
}

function isTexture(value: unknown): value is CanvasTexture {
  return value === "none" || value === "dots" || value === "lines";
}

function parseSaved(raw: string | null): CanvasStyle | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<CanvasStyle>;
    const bg = typeof data.bg === "string" ? normalizeHex(data.bg) : null;
    const textureColor = typeof data.textureColor === "string" ? normalizeHex(data.textureColor) : null;
    if (!bg || !textureColor || !isTexture(data.texture)) return null;
    const opacity = clamp(Number(data.opacity), 0, 70);
    const spacing = clamp(Number(data.spacing), 12, 64);
    if (!Number.isFinite(opacity) || !Number.isFinite(spacing)) return null;
    return { bg, texture: data.texture, textureColor, opacity, spacing };
  } catch {
    return null;
  }
}

function readSaved(): CanvasStyle | null {
  try {
    return parseSaved(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** The user's canvas look; null means "never customized", which keeps the app's built-in canvas. */
class CanvasStyleStore extends Store {
  private saved: CanvasStyle | null = readSaved();

  getSaved = (): CanvasStyle | null => this.saved;

  set(style: CanvasStyle): void {
    this.commit({ ...style });
  }

  restoreDefault(): void {
    this.commit(null);
  }

  reset(): void {
    // Appearance is machine-wide user chrome, so a workspace switch leaves it alone.
  }

  private commit(next: CanvasStyle | null): void {
    this.saved = next;
    this.persist();
    this.emit();
  }

  private persist(): void {
    try {
      if (this.saved) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The style still applies for this session when browser storage is unavailable.
    }
  }
}

export const canvasStyleStore = new CanvasStyleStore().markGlobalStore();

export function useSavedCanvasStyle(): CanvasStyle | null {
  return useSyncExternalStore(canvasStyleStore.subscribe, canvasStyleStore.getSaved);
}
