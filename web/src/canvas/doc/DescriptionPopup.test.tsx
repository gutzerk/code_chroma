import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { DescriptionPopup } from "./DescriptionPopup";
import { descriptionPopupStore } from "./descriptionPopupStore";

afterEach(() => {
  act(() => descriptionPopupStore.reset());
});

describe("DescriptionPopup", () => {
  it("renders nothing while closed", () => {
    render(<DescriptionPopup />);
    expect(screen.queryByTestId("description-popup")).not.toBeInTheDocument();
  });

  it("shows the full title and description once opened", () => {
    render(<DescriptionPopup />);
    act(() => descriptionPopupStore.open("gateway-orchestration/internal", "Handles internal routing logic"));

    expect(screen.getByText("gateway-orchestration/internal")).toBeInTheDocument();
    expect(screen.getByText("Handles internal routing logic")).toBeInTheDocument();
  });

  it("closes when the close button is clicked", () => {
    render(<DescriptionPopup />);
    act(() => descriptionPopupStore.open("Auth service", "Handles login"));

    fireEvent.click(screen.getByRole("button", { name: "Close Auth service description" }));

    expect(screen.queryByTestId("description-popup")).not.toBeInTheDocument();
  });

  it("closes when the backdrop is clicked but not when the panel itself is clicked", () => {
    render(<DescriptionPopup />);
    act(() => descriptionPopupStore.open("Auth service", "Handles login"));

    fireEvent.click(screen.getByTestId("description-popup"));
    expect(screen.getByTestId("description-popup")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("description-popup-backdrop"));
    expect(screen.queryByTestId("description-popup")).not.toBeInTheDocument();
  });

  it("closes on Escape key", () => {
    render(<DescriptionPopup />);
    act(() => descriptionPopupStore.open("Auth service", "Handles login"));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByTestId("description-popup")).not.toBeInTheDocument();
  });

  it("re-opening with a different entry replaces the previous one", () => {
    render(<DescriptionPopup />);
    act(() => descriptionPopupStore.open("Auth service", "Handles login"));
    act(() => descriptionPopupStore.open("Billing", "Handles invoices"));

    expect(screen.queryByText("Auth service")).not.toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
  });
});
