import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateIssueDialog } from "./CreateIssueDialog";

afterEach(() => {
  delete window.codechromaUpdates;
  vi.restoreAllMocks();
});

function setup() {
  const onDismiss = vi.fn();
  render(<CreateIssueDialog onDismiss={onDismiss} />);
  return { onDismiss };
}

describe("CreateIssueDialog", () => {
  it("disables Create issue until a title is entered", () => {
    setup();
    expect(screen.getByRole("button", { name: "Create issue" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Canvas freezes on zoom" } });

    expect(screen.getByRole("button", { name: "Create issue" })).toBeEnabled();
  });

  it("defaults the bug label and lets a single other pill be selected", () => {
    setup();
    const bug = screen.getByRole("button", { name: "bug" });
    const enhancement = screen.getByRole("button", { name: "enhancement" });
    expect(bug.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(enhancement);

    expect(enhancement.getAttribute("aria-pressed")).toBe("true");
    expect(bug.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens a prefilled github.com/.../issues/new URL with the chosen title, body and label", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    setup();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Bug title" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Steps to reproduce" } });
    fireEvent.click(screen.getByRole("button", { name: "enhancement" }));
    fireEvent.click(screen.getByLabelText("Attach app version and system info"));

    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledOnce());
    const url = new URL(openSpy.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://github.com/gutzerk/code_chroma/issues/new");
    expect(url.searchParams.get("title")).toBe("Bug title");
    expect(url.searchParams.get("body")).toBe("Steps to reproduce");
    expect(url.searchParams.get("labels")).toBe("enhancement");
    expect(openSpy.mock.calls[0][1]).toBe("_blank");
  });

  it("appends app version and OS to the body when the checkbox stays checked", async () => {
    window.codechromaUpdates = {
      state: vi.fn(async () => ({ currentVersion: "0.9.0", phase: "up-to-date" as const })),
      check: vi.fn(),
      download: vi.fn(),
      restart: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    setup();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Bug title" } });

    fireEvent.click(await screen.findByRole("button", { name: "Create issue" }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledOnce());
    const url = new URL(openSpy.mock.calls[0][0] as string);
    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("App: CodeChroma 0.9.0");
    expect(body).toContain("OS:");
    expect(body).not.toMatch(/[A-Za-z]:\\|\/Users\//);
  });

  it("shows a confirmation message after opening the issue", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    setup();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Bug title" } });

    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));

    expect(await screen.findByText(/Opened in your browser/)).toBeTruthy();
  });

  it("asks for confirmation before discarding a filled-in form", () => {
    const { onDismiss } = setup();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Something" } });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Discard this issue?")).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("closes immediately when the form is empty", () => {
    const { onDismiss } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
