import { BRAND_ICONS } from "./brands.generated";

export interface BrandIconProps {
  slug: string;
}

/** A real brand logo (e.g. Stripe, PostgreSQL) for a C1 actor/sub-block the skill recognized,
 * rendered in the brand's own color rather than currentColor — unlike C1BlockIcon/NodeKindIcon,
 * the whole point of a real logo is that its color is part of what makes it recognizable. Returns
 * null for an unset/unrecognized slug so the caller can fall back to the generic kind/level icon;
 * see NodeKindGlyph in nodeChrome.tsx for that fallback chain. */
export function BrandIcon({ slug }: BrandIconProps) {
  const entry = BRAND_ICONS[slug];
  if (!entry) return null;
  return (
    <svg
      className={`c1-brand-icon c1-brand-icon-${slug}`}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      role="img"
      aria-label={entry.title}
    >
      <path fill={`#${entry.hex}`} d={entry.path} />
    </svg>
  );
}
