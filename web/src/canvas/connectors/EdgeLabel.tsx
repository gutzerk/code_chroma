import { useLayoutEffect, useRef, useState } from "react";

export interface EdgeLabelProps {
  x: number;
  y: number;
  text: string;
  /** Type of call/transport (`call`, `https`, `mcp`, ...) — when set, rendered as a second line
   * under a short divider below `text`; unset renders the single-line label exactly as before. */
  transport?: string;
  /** Applied to the caption itself; the chip behind it is always `.connector-label-chip`. */
  className?: string;
  /** `file:line` of the edge's caller (provenance) — when set, the caption becomes a clickable
   * link that opens that code location. */
  origin?: string;
  /** Opens the code at `origin` (invoked on label click or Enter); unused when `origin` is unset. */
  onOpenOrigin?: (origin: string) => void;
}

const PAD_X = 4;
const PAD_Y = 2;

/** An arrow's caption with an opaque chip measured to fit behind it. A halo stroke alone reads fine
 * over the canvas but not where a connector's label lands on a box or crosses another arrow's
 * caption, which is most of a dense diagram — so the text gets a real background box, sized from its
 * own rendered extent. jsdom implements no getBBox, so a unit test simply renders the text alone. When
 * `transport` is set the caption stacks label above a hairline, then the transport row below — all
 * inside one `<text>` so the measuring chip fits the whole caption, plus the hairline `<line>` centred
 * on the seam. */
export function EdgeLabel({
  x,
  y,
  text,
  transport,
  className,
  origin,
  onOpenOrigin,
}: EdgeLabelProps) {
  const textRef = useRef<SVGTextElement | null>(null);
  const [chip, setChip] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || typeof element.getBBox !== "function") return;
    const box = element.getBBox();
    if (!box.width || !box.height) {
      setChip(null);
      return;
    }
    setChip({
      x: box.x - PAD_X,
      y: box.y - PAD_Y,
      width: box.width + PAD_X * 2,
      height: box.height + PAD_Y * 2,
    });
  }, [x, y, text, transport]);

  // A real hairline (like the block-description divider) sits between the label and the transport
  // row, spanning the caption's inner width at the vertical centre of the measured box (the label
  // is the top row, the transport the bottom one, so the middle is the seam between them).
  const TRANSPORT_DY = 13;
  const hairlineY = chip ? chip.y + chip.height / 2 : 0;
  const hairlineLeft = chip ? chip.x + PAD_X : 0;
  const hairlineRight = chip ? chip.x + chip.width - PAD_X : 0;
  // Deriving both from one truthy branch narrows `origin`/`onOpenOrigin` together, so no `?.`/cast.
  const handleClick = origin && onOpenOrigin ? () => onOpenOrigin(origin) : undefined;
  const clickable = Boolean(handleClick);
  // Accessible name keeps the visible caption (a label read in isolation still says what the arrow
  // carries) and appends the open action, instead of aria-label replacing the caption with "Open".
  const caption = `${text}${transport ? `, ${transport}` : ""}`;
  const accessibleName = clickable && origin ? `${caption} — open ${origin}` : undefined;

  return (
    <g
      role={clickable ? "link" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={accessibleName}
      className={clickable ? "connector-label--link" : undefined}
      onClick={handleClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick?.();
              }
            }
          : undefined
      }
    >
      {chip && <rect className="connector-label-chip" rx={8} {...chip} />}
      <text ref={textRef} className={className} x={x} y={y}>
        {/* Explicit `x` on each row: with `text-anchor: middle` the text is centred on that x, and
            giving both rows the same x pins them to the same centre rather than relying on tspan
            inheriting x + anchor through SVG cascade nuances. */}
        <tspan x={x}>{text}</tspan>
        {transport ? (
          // Pixel `dy`, not `em`: em would scale from the transport row's own smaller font-size and
          // collapse the gap. Fixed px keeps the two rows cleanly separated regardless of font size.
          <tspan x={x} className="c1-relationship-label__transport" dy={TRANSPORT_DY}>
            {transport}
          </tspan>
        ) : null}
      </text>
      {chip && transport ? (
        <line
          className="c1-relationship-label__divider"
          x1={hairlineLeft}
          y1={hairlineY}
          x2={hairlineRight}
          y2={hairlineY}
        />
      ) : null}
    </g>
  );
}
