/** Parses `#rrggbb`, `rgb(r,g,b)` or `rgba(r,g,b,a)` into sRGB 0..255 channels, else null. */
export function rgbChannels(color: string): [number, number, number] | null {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = parseInt(hex[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const rgb = color.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** Formats sRGB 0..255 channels as `#rrggbb`. */
export function rgbHex(channels: readonly number[]): string {
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of a CSS color, 0 (black)..1 (white). */
export function relativeLuminance(color: string): number {
  const channels = rgbChannels(color);
  if (!channels) return 0;
  const linear = channels.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio between two CSS colors, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}
