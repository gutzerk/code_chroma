import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentInstructionSection } from "./AgentInstructionSection";
import { bridgeRequest } from "../util/httpJson";

vi.mock("../util/httpJson", async (original) => ({
  ...await original<typeof import("../util/httpJson")>(), bridgeRequest: vi.fn(),
}));
const request = vi.mocked(bridgeRequest);

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ instruction: "be terse" });
});

describe("AgentInstructionSection", () => {
  it("loads the saved instruction", async () => {
    render(<AgentInstructionSection />);

    const input = await screen.findByDisplayValue("be terse");

    expect(input).toBeTruthy();
  });

  it("saves an instruction-only PUT on blur and says Saved", async () => {
    render(<AgentInstructionSection />);
    const input = await screen.findByDisplayValue("be terse");

    fireEvent.change(input, { target: { value: "be verbose" } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.getByTestId("llm-agent-instruction-saved")).toBeTruthy());
    expect(request).toHaveBeenCalledWith("/assistant/settings",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ instruction: "be verbose" }) }));
  });

  it("does not save when nothing changed", async () => {
    render(<AgentInstructionSection />);
    const input = await screen.findByDisplayValue("be terse");

    fireEvent.blur(input);

    expect(request).toHaveBeenCalledTimes(1);
  });
});
