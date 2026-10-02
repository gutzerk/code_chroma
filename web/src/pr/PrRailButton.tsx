import { useEffect, useState } from "react";
import { RailButton } from "../canvas/RailButton";
import { RailIcon } from "../icons/RailIcon";
import { useAgentClient } from "../agents/AgentClientContext";
import { PrDialog } from "./PrDialog";
import { prStore } from "./prStore";

/** The rail's pull-request control, in the agents group because — like "Make active" — it changes
 * which workspace the canvas draws, not what is rendered of it.
 *
 * Loads the open reviews on mount even while the dialog is shut: prStore membership is half the
 * read-only signal, so without this a reload would briefly offer an Accept button inside a PR. */
export function PrRailButton() {
  const agentClient = useAgentClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    agentClient
      .listPrs()
      .then((list) => {
        if (!cancelled) prStore.setList(list.prs);
      })
      .catch(() => {
        // A bridge without the /prs routes simply has no reviews open; stay quiet.
      });
    return () => {
      cancelled = true;
    };
  }, [agentClient]);

  return (
    <>
      <RailButton
        label="Review a GitHub pull request"
        className="pr-toggle-button"
        testId="pr-toggle-button"
        pressed={open}
        onClick={() => setOpen((current) => !current)}
      >
        <RailIcon name="pull-request" />
      </RailButton>
      {open && <PrDialog onDismiss={() => setOpen(false)} />}
    </>
  );
}
