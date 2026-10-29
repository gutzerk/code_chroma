import { useState } from "react";
import type { SkillInfo } from "./types";

const SLASH_AT_CARET = /(^|\s)\/([^\s/]*)$/;

/** A textarea that lists the available skills when the user types `/`, like the agent terminal. */
export function SlashSkillTextarea({ value, skills, rows, onChange }: {
  value: string;
  skills: SkillInfo[];
  rows: number;
  onChange: (next: string) => void;
}) {
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const match = SLASH_AT_CARET.exec(value.slice(0, caret));
  const query = match ? match[2].toLowerCase() : "";
  const options = match && !dismissed ? skills.filter((s) => s.name.toLowerCase().includes(query)).slice(0, 8) : [];
  const open = options.length > 0;

  const pick = (skill: SkillInfo): void => {
    if (!match) return;
    const start = caret - match[2].length - 1;
    const inserted = `/${skill.name} `;
    onChange(value.slice(0, start) + inserted + value.slice(caret));
    setCaret(start + inserted.length);
    setActive(0);
  };

  return (
    <div className="wfe-slash">
      <textarea
        className="wfe-input wfe-textarea"
        rows={rows}
        value={value}
        placeholder="Type / to insert a skill"
        onChange={(e) => {
          setCaret(e.target.selectionStart);
          setActive(0);
          setDismissed(false);
          onChange(e.target.value);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(options[Math.min(active, options.length - 1)]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(true);
          }
        }}
      />
      {open && (
        <ul className="wfe-slash-menu" role="listbox" aria-label="Skills">
          {options.map((skill, i) => (
            <li
              key={skill.name}
              role="option"
              aria-selected={i === active}
              className={i === active ? "wfe-slash-item is-active" : "wfe-slash-item"}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(skill);
              }}
            >
              <span className="wfe-slash-name">{`/${skill.name}`}</span>
              {skill.description && <span className="wfe-slash-desc">{skill.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
