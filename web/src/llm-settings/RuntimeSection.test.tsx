import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RuntimeSection } from "./RuntimeSection";
import { bridgeRequest } from "../util/httpJson";

vi.mock("../util/httpJson", async (original) => ({
  ...await original<typeof import("../util/httpJson")>(), bridgeRequest: vi.fn(),
}));
const request = vi.mocked(bridgeRequest);
const environment = { generation: 1, source: "login shell", shell: "/bin/fish",
  warnings: [], capture_error: null };

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (path) => path === "/runtime/settings"
    ? { shell: null, timeout_seconds: 10, cli_paths: {} } : environment);
});

describe("RuntimeSection", () => {
  it("saves per-tool executable overrides", async () => {
    render(<RuntimeSection />);
    const input = await screen.findByLabelText("claude executable (optional)");
    fireEvent.change(input, { target: { value: "/my tools/claude" } });
    fireEvent.click(screen.getByRole("button", { name: "Save paths" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/runtime/settings",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ shell: null,
        timeout_seconds: 10, cli_paths: { claude: "/my tools/claude" } }) })));
  });

  it("re-detects and shows the new generation", async () => {
    render(<RuntimeSection />);
    await screen.findByLabelText("claude executable (optional)");
    request.mockResolvedValueOnce({ ...environment, generation: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Re-detect" }));
    await screen.findByText(/revision 2/);
    expect(request).toHaveBeenCalledWith("/runtime/refresh", expect.objectContaining({ method: "POST" }));
  });
});
