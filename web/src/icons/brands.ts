// Merged brand vocabulary: simple-icons first (brands.generated.ts), then the LLM/AI marks
// simple-icons withdrew (vendored into brandLobe.ts from lobe-icons, MIT). A slug in either set
// renders the same way through BrandIcon. This is the ONLY entry point for brand data — consume
// ALL_BRAND_ICONS here, never the bare generated set, so the vendored marks can't be bypassed.
import { BRAND_ICONS } from "./brands.generated";
import { BRAND_LOBE } from "./brandLobe";

/** Every brand a node's `meta.icon` can resolve to: simple-icons first, then the LLM/AI marks
 * simple-icons withdrew (vendored from lobe-icons). A slug in either set renders the same way. */
export const ALL_BRAND_ICONS = { ...BRAND_ICONS, ...BRAND_LOBE };
