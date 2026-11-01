import { useState } from "react";
import { Pill } from "./Pill";

const MAX_PILLS = 12;

/** One-tap model choice from a connection's catalog, plus a box for any name the list lacks. */
export function ModelPills({
  models,
  value,
  onPick,
  testId,
}: {
  models: string[];
  value: string;
  onPick: (model: string) => void;
  testId: string;
}) {
  const [custom, setCustom] = useState("");
  const shown = models.slice(0, MAX_PILLS);
  if (value && !shown.includes(value)) shown.unshift(value);

  const commitCustom = () => {
    const name = custom.trim();
    if (name && name !== value) onPick(name);
    setCustom("");
  };

  return (
    <div className="llm-pill-row" data-testid={testId}>
      {shown.map((model) => (
        <Pill key={model} pressed={model === value} onClick={() => onPick(model)}>
          {model}
        </Pill>
      ))}
      <input
        className="llm-pill-input"
        aria-label="Other model name"
        placeholder={models.length === 0 ? "Type a model name" : "Other…"}
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        onBlur={commitCustom}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitCustom();
        }}
      />
    </div>
  );
}
