import type { ReactNode } from "react";

const ROLE = {
  component: "#34D399",
  componentFill: "#15281F",
  external: "#F2B36B",
  changedFill: "#221D18",
  data: "#FB923C",
  pattern: "#B49CFF",
  planned: "#5EE0A0",
  plannedFill: "#18211C",
  entry: "#22D3EE",
  actor: "#94A3B8",
  arrow: "#C9CDD2",
  custom: "#9EC9FF",
} as const;

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="150" height="72" viewBox="0 0 160 80" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Static per-kind schematics in the 022 role colours; no live rendering. Keyed by kind id or a saved type's `schematic`. */
export const SCHEMATICS: Record<string, ReactNode> = {
  any: (
    <Svg>
      <rect x="10" y="8" width="140" height="64" rx="8" stroke="currentColor" strokeDasharray="4 4" opacity="0.6" />
      <rect x="28" y="24" width="28" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="104" y="24" width="28" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="80" cy="56" r="8" fill={ROLE.componentFill} stroke={ROLE.component} strokeWidth="1.5" />
      <path d="M56 32H104M42 40L73 52M118 40L87 52" stroke="currentColor" strokeWidth="1.2" />
      <path d="M80 9L82 14L87 16L82 18L80 23L78 18L73 16L78 14Z" fill={ROLE.planned} />
    </Svg>
  ),
  "system-context": (
    <Svg>
      <circle cx="22" cy="28" r="6" stroke={ROLE.actor} strokeWidth="1.5" />
      <path d="M12 50Q22 34 32 50" stroke={ROLE.actor} strokeWidth="1.5" />
      <rect x="56" y="20" width="48" height="40" rx="6" fill={ROLE.componentFill} stroke={ROLE.component} strokeWidth="1.5" />
      <rect x="124" y="10" width="28" height="20" rx="4" stroke={ROLE.external} strokeWidth="1.5" strokeDasharray="3 3" />
      <rect x="124" y="50" width="28" height="20" rx="4" stroke={ROLE.external} strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M34 40H56M104 32L124 22M104 48L124 58" stroke="currentColor" strokeWidth="1.2" />
    </Svg>
  ),
  patterns: (
    <Svg>
      <rect x="8" y="8" width="68" height="64" rx="8" stroke={ROLE.pattern} strokeDasharray="4 3" strokeWidth="1.3" />
      <rect x="18" y="18" width="48" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="18" y="46" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="46" y="46" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M42 32L28 46M42 32L56 46" stroke="currentColor" strokeWidth="1.2" />
      <rect x="86" y="8" width="66" height="64" rx="8" stroke={ROLE.pattern} strokeDasharray="4 3" strokeWidth="1.3" />
      <circle cx="119" cy="26" r="8" stroke="currentColor" strokeWidth="1.5" />
      <rect x="96" y="46" width="46" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M119 34V46" stroke="currentColor" strokeWidth="1.2" />
    </Svg>
  ),
  impact: (
    <Svg>
      <rect x="14" y="14" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <rect x="66" y="14" width="28" height="20" rx="3" fill={ROLE.changedFill} stroke={ROLE.external} strokeWidth="1.8" />
      <rect x="118" y="14" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="46" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <rect x="66" y="46" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="118" y="46" width="28" height="20" rx="3" fill={ROLE.changedFill} stroke={ROLE.external} strokeWidth="1.8" />
      <path d="M42 24H66M42 56H66" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      <path d="M94 24H118M80 34V46M94 56H118" stroke={ROLE.external} strokeWidth="1.4" />
    </Svg>
  ),
  plan: (
    <Svg>
      <rect x="12" y="12" width="36" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="12" y="48" width="36" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="62" y="30" width="36" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="114" y="26" width="38" height="28" rx="4" fill={ROLE.plannedFill} stroke={ROLE.planned} strokeWidth="1.5" strokeDasharray="4 3" />
      <path d="M48 22L62 36M48 58L62 44" stroke="currentColor" strokeWidth="1.2" />
      <path d="M98 40H114" stroke={ROLE.planned} strokeWidth="1.4" strokeDasharray="3 3" />
      <path d="M133 34V46M127 40H139" stroke={ROLE.planned} strokeWidth="1.5" />
    </Svg>
  ),
  sequence: (
    <Svg>
      <rect x="12" y="4" width="32" height="12" rx="3" stroke={ROLE.entry} strokeWidth="1.5" />
      <rect x="64" y="4" width="32" height="12" rx="3" stroke={ROLE.component} strokeWidth="1.5" />
      <rect x="116" y="4" width="32" height="12" rx="3" stroke={ROLE.data} strokeWidth="1.5" />
      <path d="M28 16V78M80 16V78M132 16V78" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
      <path d="M28 30H80M74 27L80 30L74 33" stroke={ROLE.planned} strokeWidth="1.5" />
      <path d="M80 46H132M126 43L132 46L126 49" stroke={ROLE.arrow} strokeWidth="1.5" />
      <path d="M132 62H28M34 59L28 62L34 65" stroke="currentColor" strokeWidth="1.3" strokeDasharray="4 3" />
    </Svg>
  ),
  dataflow: (
    <Svg>
      <ellipse cx="26" cy="24" rx="16" ry="5" stroke={ROLE.data} strokeWidth="1.5" />
      <path d="M10 24V54A16 5 0 0 0 42 54V24" stroke={ROLE.data} strokeWidth="1.5" />
      <circle cx="80" cy="40" r="14" fill={ROLE.componentFill} stroke={ROLE.component} strokeWidth="1.5" />
      <ellipse cx="134" cy="24" rx="16" ry="5" stroke={ROLE.data} strokeWidth="1.5" />
      <path d="M118 24V54A16 5 0 0 0 150 54V24" stroke={ROLE.data} strokeWidth="1.5" />
      <path d="M44 40H64M58 37L64 40L58 43M96 40H116M110 37L116 40L110 43" stroke={ROLE.arrow} strokeWidth="1.4" />
    </Svg>
  ),
  walkthrough: (
    <Svg>
      <rect x="10" y="52" width="40" height="16" rx="3" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      <rect x="60" y="52" width="40" height="16" rx="3" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      <rect x="110" y="52" width="40" height="16" rx="3" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      <path d="M30 34V52M80 34V52M130 34V52" stroke={ROLE.planned} strokeWidth="1.2" strokeDasharray="2 3" />
      <rect x="10" y="12" width="40" height="22" rx="4" stroke={ROLE.planned} strokeWidth="1.6" fill={ROLE.plannedFill} />
      <rect x="60" y="12" width="40" height="22" rx="4" stroke={ROLE.pattern} strokeWidth="1.6" />
      <rect x="110" y="12" width="40" height="22" rx="4" stroke={ROLE.planned} strokeWidth="1.6" fill={ROLE.plannedFill} />
      <path d="M50 23H60M56 20L60 23L56 26M100 23H110M106 20L110 23L106 26" stroke={ROLE.planned} strokeWidth="1.6" />
      <circle cx="10" cy="12" r="6.5" fill={ROLE.planned} />
      <circle cx="60" cy="12" r="6.5" fill={ROLE.pattern} />
      <circle cx="110" cy="12" r="6.5" fill={ROLE.planned} />
      <text x="10" y="12" textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" fill="#10231A">1</text>
      <text x="60" y="12" textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" fill="#10231A">2</text>
      <text x="110" y="12" textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" fill="#10231A">&#10003;</text>
    </Svg>
  ),
  layers: (
    <Svg>
      <rect x="14" y="10" width="132" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="32" width="132" height="16" rx="3" stroke={ROLE.component} strokeWidth="1.5" fill={ROLE.componentFill} />
      <rect x="14" y="54" width="132" height="16" rx="3" stroke={ROLE.data} strokeWidth="1.5" />
      <path d="M80 26V32M80 48V54" stroke={ROLE.arrow} strokeWidth="1.3" />
    </Svg>
  ),
  ownership: (
    <Svg>
      <circle cx="30" cy="22" r="7" stroke={ROLE.actor} strokeWidth="1.5" />
      <circle cx="30" cy="58" r="7" stroke={ROLE.actor} strokeWidth="1.5" />
      <rect x="84" y="10" width="62" height="24" rx="4" stroke={ROLE.component} strokeWidth="1.5" fill={ROLE.componentFill} />
      <rect x="84" y="46" width="62" height="24" rx="4" stroke={ROLE.component} strokeWidth="1.5" fill={ROLE.componentFill} />
      <path d="M37 22H84M37 58H84M37 26L84 52" stroke="currentColor" strokeWidth="1.2" />
    </Svg>
  ),
  custom: (
    <Svg>
      <rect x="14" y="14" width="40" height="52" rx="6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="66" y="14" width="40" height="20" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <rect x="66" y="46" width="40" height="20" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <rect x="118" y="26" width="28" height="28" rx="6" stroke={ROLE.custom} strokeWidth="1.5" strokeDasharray="4 3" />
      <path d="M132 34V46M126 40H138" stroke={ROLE.custom} strokeWidth="1.5" />
      <path d="M54 24H66M54 56H66" stroke="currentColor" strokeWidth="1.2" />
    </Svg>
  ),
};

/** The schematic ids a saved custom type may name (kinds.json's `schematics`); anything else falls back to `custom`. */
export const CUSTOM_SCHEMATIC_IDS = ["dataflow", "layers", "ownership"] as const;

export function schematicFor(id: string | undefined): ReactNode {
  return (id !== undefined && SCHEMATICS[id]) || SCHEMATICS.custom;
}
