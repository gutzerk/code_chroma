/** One arrowhead `<marker>` to define. `className` styles the head per view/kind; unset inherits
 * the SVG default fill, which is what the C1 markers rely on. */
export interface ArrowMarkerSpec {
  id: string;
  className?: string;
}

export interface ArrowMarkerDefsProps {
  /** Must be a module-level constant: a marker that appears and disappears as edges change makes
   * Safari drop the arrowheads already referencing it (see PatternConnections). */
  markers: readonly ArrowMarkerSpec[];
  /** Marker viewport size; the triangle path scales with it. */
  size?: number;
  /** X of the anchor point within the viewport — the point that gets pinned exactly on the path's
   * endpoint (which `orthogonalRoute.ts`'s `anchorOf` already places exactly on the target box's
   * border). Defaults to `size`, i.e. the triangle's own tip, so the head lands flush with the
   * border instead of poking past it into the box; only override for a marker whose tip isn't at
   * local x = size. */
  refX?: number;
  /** "auto-start-reverse" for overlays that also mark edge starts (the trace flow overlay). */
  orient?: string;
}

/** The `<defs>` block of arrowhead markers every relationship SVG used to inline by hand. */
export function ArrowMarkerDefs({
  markers,
  size = 10,
  refX,
  orient = "auto",
}: ArrowMarkerDefsProps) {
  const mid = size / 2;
  const resolvedRefX = refX ?? size;
  return (
    <defs>
      {markers.map((marker) => (
        <marker
          key={marker.id}
          id={marker.id}
          markerWidth={size}
          markerHeight={size}
          refX={resolvedRefX}
          refY={mid}
          orient={orient}
        >
          <path d={`M0,0 L${size},${mid} L0,${size} z`} className={marker.className} />
        </marker>
      ))}
    </defs>
  );
}
