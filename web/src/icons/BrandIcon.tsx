import { useLayoutEffect, useRef, useState } from "react";
import { ALL_BRAND_ICONS } from "./brands";

export interface BrandIconProps {
  slug: string;
}

/** Parses a CSS color into sRGB 0..255 channels, from `#rrggbb`, `rgb(r,g,b)` or `rgba(r,g,b,a)`
 * (the two shapes `getComputedStyle` actually returns). Returns null for anything else. */
function rgbChannels(color: string): [number, number, number] | null {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = parseInt(hex[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const rgb = color.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** WCAG relative luminance of a CSS color, 0 (black)..1 (white). */
function relativeLuminance(color: string): number {
  const channels = rgbChannels(color);
  if (!channels) return 0;
  const linear = channels.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio between two CSS colors, 1..21. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The block this icon lives in — the nearest `.block` / `.diagram-node-box` ancestor whose solid
 * background the logo must contrast against, or `null` when the icon isn't inside one (e.g. a plain
 * tree-row use). Only those two block shells carry a contrasting fill to measure. */
function contrastBlockRoot(element: Element | null): Element | null {
  return element?.closest(".block, .diagram-node-box") ?? null;
}

/** Lowest contrast ratio at which a brand logo keeps its own color; below this it flips to a
 * near-black/near-white stand-in so it never reads as invisible on a same-toned block. */
const MIN_CONTRAST = 2.2;

/** Resolves a logo's fill against the block's background: the brand's own color while it contrasts
 * enough, else a near-black (on light fills) or near-white (on dark fills) stand-in — the "dark block
 * → light icon, light block → dark icon" rule. `undefined` for an unrecognized brand. */
function brandFill(slug: string, background: string | null): string | undefined {
  const entry = ALL_BRAND_ICONS[slug];
  if (!entry) return undefined;
  if (!background) return `#${entry.hex}`;
  const brand = `#${entry.hex}`;
  const backgroundLuminance = relativeLuminance(background);
  if (contrastRatio(brand, background) >= MIN_CONTRAST) return brand;
  return backgroundLuminance >= 0.5 ? "#111111" : "#ffffff";
}

/** A real brand logo (e.g. Stripe, PostgreSQL) for a C1 actor/sub-block the skill recognized,
 * rendered in the brand's own color while that contrasts with the block's background, else in a
 * near-black/near-white stand-in so the logo never reads invisible on a same-toned fill — unlike
 * C1BlockIcon/NodeKindIcon, a real logo's color is part of what makes it recognizable, so the brand
 * color is kept whenever it stays legible. Returns null for an unset/unrecognized slug so the caller
 * can fall back to the generic kind/level icon; see NodeKindGlyph in nodeChrome.tsx for that chain. */
export function BrandIcon({ slug }: BrandIconProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [fill, setFill] = useState<string | undefined>(undefined);

  useLayoutEffect(() => {
    const root = contrastBlockRoot(ref.current);
    if (!root) return;
    const background = getComputedStyle(root).backgroundColor;
    // `rgba(0,0,0,0)` / "" — a transparent root has no contrasting fill to measure against.
    if (!background || background === "rgba(0, 0, 0, 0)") return;
    // No-op when the resolved fill matches — the brand color is the common case, so skip the extra
    // render pass entirely there.
    setFill((current) => {
      const resolved = brandFill(slug, background);
      return current === resolved ? current : resolved;
    });
  }, [slug]);

  const entry = ALL_BRAND_ICONS[slug];
  if (!entry) return null;
  return (
    <svg
      ref={ref}
      className={`c1-brand-icon c1-brand-icon-${slug}`}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      role="img"
      aria-label={entry.title}
    >
      <path fill={fill ?? `#${entry.hex}`} d={entry.path} />
    </svg>
  );
}
