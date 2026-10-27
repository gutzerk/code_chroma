import { useEffect, useRef, useState } from "react";
import { messageOf } from "../util/reportError";
import { bridgeRequest, jsonInit } from "../util/httpJson";

/** A free-text instruction appended to every Claude agent window's system prompt; saved when the field loses focus. */
export function AgentInstructionSection() {
  const [saved, setSaved] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bridgeRequest<{ instruction?: string }>("/assistant/settings")
      .then((settings) => {
        setSaved(settings.instruction ?? "");
        setText(settings.instruction ?? "");
      })
      .catch((err) => {
        setError(messageOf(err));
        setStatus("error");
      });
  }, []);

  const latest = useRef({ text, saved });
  latest.current = { text, saved };

  useEffect(
    () => () => {
      const { text: pending, saved: stored } = latest.current;
      if (pending !== stored) {
        void bridgeRequest("/assistant/settings", jsonInit("PUT", { instruction: pending })).catch(() => {});
      }
    },
    []
  );

  const save = async () => {
    if (text === saved) return;
    try {
      await bridgeRequest("/assistant/settings", jsonInit("PUT", { instruction: text }));
      setSaved(text);
      setError(null);
      setStatus("saved");
    } catch (err) {
      setError(messageOf(err));
      setStatus("error");
    }
  };

  return (
    <section className="llm-card" data-testid="llm-agent-instruction">
      <h3 className="llm-card-title">Agent window instructions</h3>
      <p className="llm-subtle">
        Added to the system prompt of every Claude agent window, on top of the project's AGENTS.md.
      </p>
      <textarea
        aria-label="Agent window instructions"
        data-testid="llm-agent-instruction-input"
        rows={4}
        placeholder="e.g. Answer briefly. Prefer small commits."
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus("idle");
        }}
        onBlur={() => void save()}
      />
      {status === "saved" && (
        <p className="llm-status-ok" aria-live="polite" data-testid="llm-agent-instruction-saved">
          Saved
        </p>
      )}
      {status === "error" && error && (
        <p className="llm-status-fail" aria-live="polite">
          {error}
        </p>
      )}
    </section>
  );
}
