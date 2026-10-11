/** The shape registry: `meta.shape` names → conventional diagram shapes (styled in styles.css as `.node-shape-<name>`). */
export const NODE_SHAPES = [
  "database", "client", "queue", "actor", "cache", "storage", "external",
] as const;

export type NodeShape = (typeof NODE_SHAPES)[number];

export function isNodeShape(name: string): name is NodeShape {
  return (NODE_SHAPES as readonly string[]).includes(name);
}
