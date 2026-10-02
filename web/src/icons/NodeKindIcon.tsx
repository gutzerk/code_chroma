import type { HierarchyLevel } from "../state/types";

export interface NodeKindIconProps {
  level: HierarchyLevel;
}

/** IDE-outline-style glyph per hierarchy level: folder/file get shape icons, class/function/code
 * get colored letter badges (VSCode symbol-kind convention) — shared by the inspector and both
 * canvas strategies so the same node always reads as the same kind everywhere. */
export function NodeKindIcon({ level }: NodeKindIconProps) {
  if (level === "folder") {
    return (
      <svg
        className="node-icon node-icon-folder"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.28a1.5 1.5 0 0 1 1.06.44L8.5 3H13A1.5 1.5 0 0 1 14.5 4.5v8A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3Z"
        />
      </svg>
    );
  }
  if (level === "file") {
    return (
      <svg
        className="node-icon node-icon-file"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M4 1.5A1.5 1.5 0 0 1 5.5 0h3.19a1.5 1.5 0 0 1 1.06.44l2.81 2.81a1.5 1.5 0 0 1 .44 1.06V14.5A1.5 1.5 0 0 1 11.5 16h-6A1.5 1.5 0 0 1 4 14.5v-13Z"
        />
      </svg>
    );
  }
  const badge = level === "class" ? "C" : level === "function" ? "ƒ" : "•";
  return (
    <span className={`node-icon node-icon-badge node-icon-${level}`} aria-hidden="true">
      {badge}
    </span>
  );
}
