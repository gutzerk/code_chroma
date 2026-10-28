import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SlashSkillTextarea } from "./SlashSkillTextarea";

const skills = [
  { name: "review-skill", description: "reviews" },
  { name: "grill", description: "asks" },
];

afterEach(cleanup);

function Harness({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <SlashSkillTextarea
      rows={3}
      value={value}
      skills={skills}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe("SlashSkillTextarea", () => {
  it("lists skills after a slash and inserts the picked one", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: "/re", selectionStart: 3 } });
    fireEvent.mouseDown(screen.getByRole("option", { name: /review-skill/ }));

    expect(onChange).toHaveBeenLastCalledWith("/review-skill ");
  });

  it("shows no menu without a slash", () => {
    render(<SlashSkillTextarea rows={3} value="plain" skills={skills} onChange={() => {}} />);

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
