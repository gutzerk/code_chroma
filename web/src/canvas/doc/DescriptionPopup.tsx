import { useEffect } from "react";
import { PanelCloseButton } from "../PanelCloseButton";
import { descriptionPopupStore, useDescriptionPopupEntry } from "./descriptionPopupStore";

/**
 * Small modal for a block's full, untruncated description — opened by the "?" button
 * `CanvasNodeBox` shows next to a description that CSS line-clamps (see `.diagram-node-box-desc` /
 * `.block-description` in styles.css).
 * Deliberately separate from the existing click-opens-InspectorPanel behavior on the rest of the
 * box — that dock stays for code/navigation, this is just the quickest way to read a clipped
 * description. Renders nothing while closed, so it can mount unconditionally in RootCanvas.
 */
export function DescriptionPopup() {
  const entry = useDescriptionPopupEntry();

  useEffect(() => {
    if (!entry) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") descriptionPopupStore.close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [entry]);

  if (!entry) return null;

  return (
    <div
      className="description-popup-backdrop"
      data-testid="description-popup-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) descriptionPopupStore.close();
      }}
    >
      <div className="description-popup" data-testid="description-popup">
        <div className="description-popup-titlebar" data-testid="description-popup-titlebar">
          <span className="description-popup-title">{entry.title}</span>
          <PanelCloseButton
            className="description-popup-close"
            ariaLabel={`Close ${entry.title} description`}
            onClick={descriptionPopupStore.close}
          />
        </div>
        <div className="description-popup-body" data-testid="description-popup-body">
          {entry.description}
        </div>
      </div>
    </div>
  );
}
