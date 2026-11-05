import { useLayoutEffect, useRef } from "react";
import { useAgentClient } from "../AgentClientContext";
import { answerPermission, openAgent } from "../agentFocus";
import { attentionBody, attentionTitle } from "../agentNotifications";
import { useAgent } from "../agentStore";
import { StatusIndicator } from "../StatusIndicator";
import { agentToastStore, useAgentToasts, type AgentToast } from "./toastStore";
import "./AgentToastLayer.css";

/** The toast's headline and body, read from the live agent record so they never lag its permission request. */
function useToastText(toast: AgentToast): { title: string; body: string } {
  const agent = useAgent(toast.agentId);
  if (!agent) return { title: toast.title, body: toast.body };
  return { title: attentionTitle(agent, toast.kind), body: attentionBody(agent, toast.kind) };
}

/** Moves focus off a card that is about to unmount: back where it came from, else onto another toast. */
function restoreFocus(card: HTMLElement, returnTo: HTMLElement | null): void {
  if (!card.contains(document.activeElement)) return;
  if (returnTo?.isConnected) {
    returnTo.focus();
    return;
  }
  const other = [...(card.parentElement?.querySelectorAll<HTMLElement>(".agent-toast") ?? [])].find((el) => el !== card);
  other?.querySelector<HTMLElement>("button")?.focus();
}

function ToastCard({ toast }: { toast: AgentToast }) {
  const client = useAgentClient();
  const agent = useAgent(toast.agentId);
  const { title, body } = useToastText(toast);
  const permission = toast.kind === "blocked" ? agent?.pending_permission : null;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const syncHold = () => agentToastStore.hold(toast.agentId, hovered.current || focused.current);

  useLayoutEffect(() => {
    const card = cardRef.current;
    return () => {
      if (card) restoreFocus(card, returnFocus.current);
    };
  }, []);

  return (
    <div
      ref={cardRef}
      className="agent-toast"
      data-status={toast.kind}
      data-testid={`agent-toast-${toast.agentId}`}
      onMouseEnter={() => {
        hovered.current = true;
        syncHold();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        syncHold();
      }}
      onFocus={(event) => {
        const from = event.relatedTarget;
        if (!focused.current && from instanceof HTMLElement && !event.currentTarget.contains(from)) {
          returnFocus.current = from;
        }
        focused.current = true;
        syncHold();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focused.current = false;
        syncHold();
      }}
    >
      <StatusIndicator status={toast.kind} size="icon" />
      <div className="agent-toast-text">
        <div className="agent-toast-title">{title}</div>
        <div className="agent-toast-body">{body}</div>
        <div className="agent-toast-actions">
          {permission && client.permission && (
            <button
              type="button"
              className="agent-status-action agent-status-action--toast"
              data-status="blocked"
              aria-label={`Allow ${agent?.title ?? toast.agentId}: ${permission.summary}`}
              onClick={() => void answerPermission(client, toast.agentId, permission.request_id, "allow")}
            >
              Allow
            </button>
          )}
          <button
            type="button"
            className="agent-status-action agent-status-action--toast"
            onClick={() => openAgent(client, toast.agentId)}
          >
            Open agent
          </button>
        </div>
      </div>
      {toast.kind !== "blocked" && (
        <button
          type="button"
          className="agent-toast-close"
          aria-label="Close notification"
          onClick={() => agentToastStore.dismiss(toast.agentId)}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** One screen-reader line per toast, inside an always-mounted live region. */
function ToastAnnouncement({ toast }: { toast: AgentToast }) {
  const { title, body } = useToastText(toast);
  return (
    <p>
      {title}. {body}
    </p>
  );
}

/** Bottom-right stack: blocked stays until answered, error until closed, done for 6 s (paused while hovered or focused). */
export function AgentToastLayer() {
  const toasts = useAgentToasts();
  const urgent = toasts.filter((toast) => toast.kind !== "done");
  const done = toasts.filter((toast) => toast.kind === "done");
  return (
    <>
      <div className="visually-hidden" aria-live="assertive" data-testid="agent-toast-live-assertive">
        {urgent.map((toast) => (
          <ToastAnnouncement key={toast.agentId} toast={toast} />
        ))}
      </div>
      <div className="visually-hidden" aria-live="polite" data-testid="agent-toast-live-polite">
        {done.map((toast) => (
          <ToastAnnouncement key={toast.agentId} toast={toast} />
        ))}
      </div>
      {toasts.length > 0 && (
        <div className="agent-toast-layer" data-testid="agent-toast-layer">
          {toasts.map((toast) => (
            <ToastCard key={toast.agentId} toast={toast} />
          ))}
        </div>
      )}
    </>
  );
}
