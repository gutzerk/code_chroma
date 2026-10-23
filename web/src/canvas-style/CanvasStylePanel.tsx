import { useState } from "react";
import { ModalDialog } from "../agents/ModalDialog";
import {
  CANVAS_STYLE_DEFAULT,
  CANVAS_STYLE_PRESETS,
  canvasStyleStore,
  isLightBackground,
  matchPreset,
  normalizeHex,
  sameStyle,
  textureImage,
  toStyle,
  useSavedCanvasStyle,
  type CanvasStyle,
  type CanvasTexture,
} from "./canvasStyleStore";

const TEXTURES: ReadonlyArray<{ id: CanvasTexture; name: string }> = [
  { id: "none", name: "None" },
  { id: "dots", name: "Dots" },
  { id: "lines", name: "Lines" },
];

/** Tile previews use a fixed small grid so the pattern reads at swatch size. */
function swatchStyle(texture: CanvasTexture, bg: string, color: string, opacity: number) {
  const alpha = texture === "dots" ? Math.max(0.5, opacity / 100 + 0.25) : Math.max(0.4, opacity / 100 + 0.2);
  return {
    backgroundColor: bg,
    backgroundImage: textureImage(texture, color, alpha, Math.max(0.9, opacity / 36)),
    backgroundSize: texture === "none" ? "auto" : "10px 10px",
  };
}

function ColorField({
  label,
  testId,
  value,
  example,
  onChange,
}: {
  label: string;
  testId: string;
  value: string;
  example: string;
  onChange: (hex: string) => void;
}) {
  // While the text is being typed it may be invalid; null means "show the committed value".
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value.toUpperCase();
  const invalid = draft !== null && normalizeHex(draft) === null;

  return (
    <div className="canvas-style-field">
      <div className="canvas-style-color-row">
        <input
          type="color"
          className="canvas-style-picker"
          aria-label={`${label} color`}
          data-testid={`${testId}-picker`}
          value={value}
          onChange={(event) => {
            setDraft(null);
            onChange(event.target.value);
          }}
        />
        <input
          type="text"
          className="canvas-style-hex"
          aria-label={`${label} color hex`}
          aria-invalid={invalid}
          data-testid={`${testId}-hex`}
          value={text}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            const raw = event.target.value;
            const hex = normalizeHex(raw);
            setDraft(raw);
            if (hex) onChange(hex);
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
      {invalid && <p className="canvas-style-error">Enter a 6-digit hex color, for example {example}.</p>}
    </div>
  );
}

function Slider({
  id,
  label,
  min,
  max,
  value,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="canvas-style-slider">
      <div className="canvas-style-slider-head">
        <label htmlFor={id}>{label}</label>
        <span>{`${value}${suffix}`}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/** Settings → Canvas style: background colour and texture of the canvas; block and line colours stay as the diagram sets them. */
export function CanvasStylePanel({ onDismiss }: { onDismiss: () => void }) {
  const saved = useSavedCanvasStyle();
  const baseline = saved ?? CANVAS_STYLE_DEFAULT;
  const [style, setStyle] = useState<CanvasStyle>(baseline);
  const preset = matchPreset(style);
  const dirty = !sameStyle(style, baseline);
  const update = (patch: Partial<CanvasStyle>) => setStyle((current) => ({ ...current, ...patch }));

  return (
    <ModalDialog label="Canvas style" testId="canvas-style-dialog" className="canvas-style-dialog" onDismiss={onDismiss}>
      <header className="llm-dialog-header">
        <button type="button" className="canvas-style-back" aria-label="Back" onClick={onDismiss}>
          ‹
        </button>
        <h2>Canvas style</h2>
      </header>
      <p className="canvas-style-lede">
        Background and texture for every diagram. Block and line colors stay as the diagram sets them.
      </p>

      <section className="canvas-style-section">
        <div className="canvas-style-section-head">
          <h3>Theme</h3>
          {!preset && <span data-testid="canvas-style-custom">Custom</span>}
        </div>
        <div className="canvas-style-tiles">
          {CANVAS_STYLE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="canvas-style-tile"
              aria-pressed={preset?.id === p.id}
              data-testid={`canvas-style-preset-${p.id}`}
              onClick={() => setStyle(toStyle(p))}
            >
              <span className="canvas-style-swatch" style={swatchStyle(p.texture, p.bg, p.textureColor, p.opacity)} />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="canvas-style-section">
        <h3>Background</h3>
        <ColorField
          label="Background"
          testId="canvas-style-bg"
          value={style.bg}
          example="#0B1A2A"
          onChange={(bg) => update({ bg })}
        />
        {isLightBackground(style.bg) && (
          <div role="status" className="canvas-style-warning" data-testid="canvas-style-light-warning">
            This background is light. Diagram text and lines are light too, so they may be hard to read.
          </div>
        )}
      </section>

      <section className="canvas-style-section">
        <h3>Texture</h3>
        <div className="canvas-style-tiles">
          {TEXTURES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="canvas-style-tile"
              aria-pressed={style.texture === t.id}
              data-testid={`canvas-style-texture-${t.id}`}
              onClick={() => update({ texture: t.id })}
            >
              <span
                className="canvas-style-swatch canvas-style-swatch--short"
                style={swatchStyle(t.id, style.bg, style.textureColor, style.opacity)}
              />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
        {style.texture !== "none" && (
          <div className="canvas-style-texture-controls" data-testid="canvas-style-texture-controls">
            <span className="canvas-style-label">Color</span>
            <ColorField
              label="Texture"
              testId="canvas-style-tc"
              value={style.textureColor}
              example="#294766"
              onChange={(textureColor) => update({ textureColor })}
            />
            <div className="canvas-style-sliders">
              <Slider
                id="canvas-style-opacity"
                label="Opacity"
                min={0}
                max={70}
                value={style.opacity}
                suffix="%"
                onChange={(opacity) => update({ opacity })}
              />
              <Slider
                id="canvas-style-spacing"
                label="Spacing"
                min={12}
                max={64}
                value={style.spacing}
                suffix=" px"
                onChange={(spacing) => update({ spacing })}
              />
            </div>
          </div>
        )}
      </section>

      <div className="canvas-style-footer">
        <button
          type="button"
          className="llm-button-ghost"
          data-testid="canvas-style-reset"
          disabled={saved === null}
          onClick={() => {
            canvasStyleStore.restoreDefault();
            setStyle(CANVAS_STYLE_DEFAULT);
          }}
        >
          Reset to default
        </button>
        <button
          type="button"
          className="llm-button-primary"
          data-testid="canvas-style-apply"
          disabled={!dirty}
          onClick={() => canvasStyleStore.set(style)}
        >
          Apply
        </button>
      </div>
    </ModalDialog>
  );
}
