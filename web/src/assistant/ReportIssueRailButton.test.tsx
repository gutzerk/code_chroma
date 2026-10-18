import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReportIssueRailButton } from "./ReportIssueRailButton";

describe("ReportIssueRailButton", () => {
  it("opens and closes the Create issue dialog", async () => {
    render(<ReportIssueRailButton />);

    fireEvent.click(screen.getByTestId("report-issue-toggle-button"));
    expect(await screen.findByTestId("create-issue-dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.queryByTestId("create-issue-dialog")).toBeNull();
  });
});
