import { useEffect, useState } from "react";
import { bridgeRequest, jsonInit } from "../util/httpJson";

interface RuntimeSettings {
  shell: string | null;
  timeout_seconds: number;
  cli_paths: Record<string, string>;
}
interface EnvironmentInfo {
  generation: number;
  source: string;
  shell: string | null;
  warnings: string[];
  capture_error: string | null;
}

/** Machine-wide discovery controls; executable overrides also apply to assigned providers. */
export function RuntimeSection() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      bridgeRequest<RuntimeSettings>("/runtime/settings"),
      bridgeRequest<EnvironmentInfo>("/runtime/environment"),
    ]).then(([loaded, snapshot]) => {
      if (active) { setSettings(loaded); setEnvironment(snapshot); }
    }).catch((error: unknown) => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, []);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setMessage("");
    try {
      const cli_paths = Object.fromEntries(
        Object.entries(settings.cli_paths).filter(([, path]) => path.trim()),
      );
      const saved = await bridgeRequest<RuntimeSettings>(
        "/runtime/settings", jsonInit("PUT", { ...settings, cli_paths }),
      );
      setSettings(saved);
      setEnvironment(await bridgeRequest<EnvironmentInfo>("/runtime/environment"));
      setMessage("Saved. Executable paths apply to future launches.");
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }

  async function redetect() {
    setBusy(true);
    setMessage("");
    try {
      setEnvironment(await bridgeRequest<EnvironmentInfo>("/runtime/refresh", jsonInit("POST", {})));
      setMessage("Executable environment refreshed.");
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }

  if (!settings) return <p role="status">{message || "Loading executable settings…"}</p>;
  const names = [...new Set(["claude", "gh", "codex", "gemini", "git", "npm",
    ...Object.keys(settings.cli_paths)])];
  return (
    <section aria-label="CLI tools">
      <p>CodeChroma discovers executable tools from your shell. Override a path when needed.</p>
      <label className="llm-field">
        <span className="llm-field-label">Shell executable (optional)</span>
        <input value={settings.shell ?? ""} placeholder="Use your account login shell"
          onChange={(event) => setSettings({ ...settings, shell: event.target.value || null })} />
      </label>
      <label className="llm-field">
        <span className="llm-field-label">Shell timeout (seconds)</span>
        <input type="number" min="0.1" max="60" step="0.1" value={settings.timeout_seconds}
          onChange={(event) => setSettings({ ...settings,
            timeout_seconds: Number(event.target.value) })} />
      </label>
      {names.map((name) => (
        <label className="llm-field" key={name}>
          <span className="llm-field-label">{name} executable (optional)</span>
          <input value={settings.cli_paths[name] ?? ""} placeholder="Full path to executable"
            onChange={(event) => setSettings({ ...settings,
              cli_paths: { ...settings.cli_paths, [name]: event.target.value } })} />
        </label>
      ))}
      <p className="llm-field-hint">Use an executable file or wrapper script. Aliases and shell
        functions cannot be launched as CLI tools.</p>
      <button type="button" disabled={busy} onClick={() => { void save(); }}>Save paths</button>
      <button type="button" disabled={busy} onClick={() => { void redetect(); }}>Re-detect</button>
      {environment && <p>Environment: {environment.source}
        {environment.shell ? ` (${environment.shell})` : ""} · revision {environment.generation}</p>}
      {environment?.capture_error && <p role="status">{environment.capture_error}</p>}
      {environment?.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
