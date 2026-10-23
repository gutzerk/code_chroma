import type { ReactNode } from "react";

interface IconProps {
  size?: number;
}

function Icon({ children, size = 16 }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const AgentsIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="4" y="7" width="16" height="12" rx="3" />
    <path d="M12 3v4M9 13h.01M15 13h.01" />
  </Icon>
);
export const WorkflowsIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8.5 6H14a3 3 0 0 1 3 3v6.5" />
  </Icon>
);
export const PlusIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const ExpandIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);
export const CollapseIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
export const StretchIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />
  </Icon>
);
export const FullScreenIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);
export const ChevronDownIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
export const ExitFullScreenIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </Icon>
);
export const HandleChevronLeft = () => (
  <Icon size={12}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);
export const HandleChevronRight = () => (
  <Icon size={12}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
export const HandleCollapse = () => (
  <Icon size={12}>
    <path d="M6 6l6 6-6 6M18 5v14" />
  </Icon>
);
