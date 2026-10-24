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
    render(<ShareMenu />);

    fireEvent.click(screen.getByTestId("share-menu-button"));

    expect(screen.getByTestId("share-menu-item-png")).toBeInTheDocument();
    expect(screen.getByTestId("share-menu-item-html")).toBeInTheDocument();
    expect(screen.getByTestId("share-menu-item-pdf")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<ShareMenu />);
    fireEvent.click(screen.getByTestId("share-menu-button"));

    fireEvent.keyDown(screen.getByTestId("share-menu-list"), { key: "Escape" });

    expect(screen.queryByTestId("share-menu-list")).not.toBeInTheDocument();
  });

  it("renders the chosen format and asks where to save it", async () => {
    const blob = new Blob(["x"]);
    vi.spyOn(capture, "prepareCapture").mockReturnValue({} as capture.CanvasCapture);
    vi.spyOn(formats, "buildExport").mockResolvedValue({ blob, mime: "image/png", extension: "png" });
    const saveSpy = vi.spyOn(save, "saveFile").mockResolvedValue(true);
    render(<ShareMenu name="my repo" />);
    fireEvent.click(screen.getByTestId("share-menu-button"));

    fireEvent.click(screen.getByTestId("share-menu-item-png"));

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith({ name: "my-repo-diagram.png", mime: "image/png", blob }),
    );
    expect(formats.buildExport).toHaveBeenCalledWith("png", expect.anything(), "my-repo-diagram");
  });

  it("says so when there is nothing to export", () => {
    vi.spyOn(capture, "prepareCapture").mockReturnValue(null);
    render(<ShareMenu />);
    fireEvent.click(screen.getByTestId("share-menu-button"));

    fireEvent.click(screen.getByTestId("share-menu-item-pdf"));

    expect(screen.getByTestId("share-menu-error")).toHaveTextContent("Nothing to export yet");
  });
});
