import { useLayoutEffect, useRef, useState } from "react";

export interface EdgeLabelProps {
  x: number;
  y: number;
  text: string;
  /** Applied to the caption itself; the chip behind it is always `.connector-label-chip`. */
  className?: string;
}

const PAD_X = 4;
const PAD_Y = 2;

/** An arrow's caption with an opaque chip measured to fit behind it. A halo stroke alone reads fine
 * over the canvas but not where a connector's label lands on a box or crosses another arrow's
 * caption, which is most of a dense diagram — so the text gets a real background box, sized from its
 * own rendered extent. jsdom implements no getBBox, so a unit test simply renders the text alone. */
export function EdgeLabel({ x, y, text, className }: EdgeLabelProps) {
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
  }, [x, y, text]);

  return (
    <>
      {chip && <rect className="connector-label-chip" rx={3} {...chip} />}
      <text ref={textRef} className={className} x={x} y={y}>
        {text}
      </text>
    </>
  );
}
