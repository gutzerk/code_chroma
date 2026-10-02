import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Breadcrumb } from "./Breadcrumb";

const NAMES: Record<string, string> = {
  root: "codechroma",
  src: "src",
  "app-folder": "app",
  "handlers-file": "handlers.ts",
};

function getName(id: string): string {
  return NAMES[id] ?? id;
}

describe("Breadcrumb", () => {
  it("renders the deepest currently-expanded path, root-first, resolved to display names", () => {
    render(
      <Breadcrumb
        path={["root", "src", "app-folder", "handlers-file"]}
        getName={getName}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText("codechroma")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.getByTestId("breadcrumb-current")).toHaveTextContent("handlers.ts");
  });

  it("falls back to the raw id when a name isn't cached yet", () => {
    render(<Breadcrumb path={["unknown-id"]} getName={getName} onNavigate={vi.fn()} />);
    expect(screen.getByTestId("breadcrumb-current")).toHaveTextContent("unknown-id");
  });

  it("renders an empty current crumb when nothing is expanded", () => {
    render(<Breadcrumb path={[]} getName={getName} onNavigate={vi.fn()} />);
    expect(screen.getByTestId("breadcrumb-current")).toHaveTextContent("");
  });

  it("navigates to an ancestor when its crumb is clicked, not the deepest node", () => {
    const onNavigate = vi.fn();
    render(
      <Breadcrumb
        path={["root", "src", "app-folder", "handlers-file"]}
        getName={getName}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("breadcrumb-item-src"));
    expect(onNavigate).toHaveBeenCalledWith("src");
  });

  it("updates as the deepest expansion changes, without requiring a full remount", () => {
    const { rerender } = render(
      <Breadcrumb path={["root", "src"]} getName={getName} onNavigate={vi.fn()} />,
    );
    expect(screen.getByTestId("breadcrumb-current")).toHaveTextContent("src");

    rerender(
      <Breadcrumb path={["root", "src", "app-folder"]} getName={getName} onNavigate={vi.fn()} />,
    );
    expect(screen.getByTestId("breadcrumb-current")).toHaveTextContent("app");
  });
});
