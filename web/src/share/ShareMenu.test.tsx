import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareMenu } from "./ShareMenu";
import * as capture from "./captureCanvas";
import * as formats from "./exportFormats";
import * as save from "./saveFile";

describe("ShareMenu", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists PNG, HTML and PDF when the Share button is clicked", () => {
    render(<ShareMenu layers={["a"]} />);

    fireEvent.click(screen.getByTestId("share-menu-button"));

    expect(screen.getByTestId("share-menu-item-png")).toBeInTheDocument();
    expect(screen.getByTestId("share-menu-item-html")).toBeInTheDocument();
    expect(screen.getByTestId("share-menu-item-pdf")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<ShareMenu layers={["a"]} />);
    fireEvent.click(screen.getByTestId("share-menu-button"));

    fireEvent.keyDown(screen.getByTestId("share-menu-list"), { key: "Escape" });

    expect(screen.queryByTestId("share-menu-list")).not.toBeInTheDocument();
  });

  it("renders the chosen format and asks where to save it", async () => {
    const blob = new Blob(["x"]);
    vi.spyOn(capture, "prepareCapture").mockReturnValue({} as capture.CanvasCapture);
    vi.spyOn(formats, "buildExport").mockResolvedValue({ blob, mime: "image/png", extension: "png" });
    const saveSpy = vi.spyOn(save, "saveFile").mockResolvedValue(true);
    render(<ShareMenu name="my repo" layers={["a", "b"]} />);
    fireEvent.click(screen.getByTestId("share-menu-button"));

    fireEvent.click(screen.getByTestId("share-menu-item-png"));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const request = saveSpy.mock.calls[0][0];
    expect(request).toMatchObject({ name: "my-repo-diagram.png", mime: "image/png" });
    await expect(request.blob).resolves.toBe(blob);
    expect(formats.buildExport).toHaveBeenCalledWith("png", expect.anything(), "my-repo-diagram");
    expect(capture.prepareCapture).toHaveBeenCalledWith(document, ["a", "b"]);
  });

  it("is disabled while no diagram is selected", () => {
    render(<ShareMenu layers={[]} />);

    expect(screen.getByTestId("share-menu-button")).toBeDisabled();
  });

  it("says so when there is nothing to export", () => {
    vi.spyOn(capture, "prepareCapture").mockReturnValue(null);
    render(<ShareMenu layers={["a"]} />);
    fireEvent.click(screen.getByTestId("share-menu-button"));

    fireEvent.click(screen.getByTestId("share-menu-item-pdf"));

    expect(screen.getByTestId("share-menu-error")).toHaveTextContent("Nothing to export yet");
  });
});
