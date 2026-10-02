import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useGroupDrag, type GroupDragOptions } from "./useGroupDrag";

type Offset = { x: number; y: number };

function Harness({
  selectedIds,
  offsets,
  onGroupPreview,
  onGroupCommit,
  enabled,
}: {
  selectedIds: string[];
  offsets: Record<string, Offset>;
  onGroupPreview: GroupDragOptions["onGroupPreview"];
  onGroupCommit: GroupDragOptions["onGroupCommit"];
  enabled?: boolean;
}) {
  const { handleProps } = useGroupDrag({
    selectedIds: () => selectedIds,
    getOffset: (id) => offsets[id] ?? { x: 0, y: 0 },
    onGroupPreview,
    onGroupCommit,
    enabled,
  });
  return <div data-testid="handle" {...handleProps} />;
}

describe("useGroupDrag", () => {
  it("applies the handle's own delta-from-start to every selected id", () => {
    const preview = vi.fn();
    const commit = vi.fn();
    render(
      <Harness
        selectedIds={["a", "b"]}
        offsets={{ a: { x: 0, y: 0 }, b: { x: 10, y: 20 } }}
        onGroupPreview={preview}
        onGroupCommit={commit}
      />,
    );
    const handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 50, clientY: 30 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 50, clientY: 30 });

    expect(preview).toHaveBeenCalledWith({ a: { x: 50, y: 30 }, b: { x: 60, y: 50 } });
    expect(commit).toHaveBeenCalledWith({ a: { x: 50, y: 30 }, b: { x: 60, y: 50 } });
  });

  it("does not fire either callback for a sub-threshold press (a plain click)", () => {
    const preview = vi.fn();
    const commit = vi.fn();
    render(
      <Harness
        selectedIds={["a"]}
        offsets={{ a: { x: 0, y: 0 } }}
        onGroupPreview={preview}
        onGroupCommit={commit}
      />,
    );
    const handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 1, clientY: 0 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 1, clientY: 0 });

    expect(preview).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("does nothing when disabled — the caller's solo-drag path owns the gesture instead", () => {
    const preview = vi.fn();
    const commit = vi.fn();
    render(
      <Harness
        selectedIds={["a"]}
        offsets={{ a: { x: 0, y: 0 } }}
        onGroupPreview={preview}
        onGroupCommit={commit}
        enabled={false}
      />,
    );
    const handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 50, clientY: 30 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 50, clientY: 30 });

    expect(preview).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
