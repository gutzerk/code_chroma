import { useEffect, useRef } from "react";
import { projectTreePanelStore } from "../canvas/projectTreePanelStore";
import { tutorialSimStore } from "./tutorialSim";
import { tutorialStore } from "./tutorialStore";
import { TUTORIAL_ROOT_NAME } from "./tutorialSteps";

/** Starts the tutorial once when the opened project is the bundled example, with the tree closed. */
export function useStartTutorial(rootName: string | null): void {
  const started = useRef(false);
  useEffect(() => {
    if (started.current || rootName !== TUTORIAL_ROOT_NAME) return;
    started.current = true;
    projectTreePanelStore.reset();
    tutorialSimStore.enableGate();
    tutorialStore.start();
  }, [rootName]);
}
