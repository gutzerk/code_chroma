import type { TerminalClient, TerminalSession } from "./TerminalClient";

const QUESTION = "\x1b[1mWhat do you want to see?\x1b[0m A flow, a component, a feature... or just ask for the whole project.\r\n\r\n";
const INPUT_BOX = "\x1b[2m╭────────────────────────────────────────────────╮\x1b[0m\r\n\x1b[2m│\x1b[0m > ";

/** Dev-only preview (`?mockTerminal=1`): plays the bridge's drawing-agent banner, then echoes typed text like a CLI input box. */
export class PreviewTerminalClient implements TerminalClient {
  connect(): TerminalSession {
    let onData: (data: string) => void = () => {};
    let typed = "";
    setTimeout(() => onData(QUESTION + INPUT_BOX), 150);
    return {
      write(data: string) {
        // eslint-disable-next-line no-control-regex -- strips cursor/escape sequences (arrow keys, bracketed paste) before echoing
        for (const ch of data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")) {
          if (ch === "\r") {
            onData(`\r\n\r\n\x1b[36m●\x1b[0m Got it: ${typed || "the whole project"}. Running context…\r\n`);
            typed = "";
          } else if (ch === "\x7f") {
            if (typed) { typed = typed.slice(0, -1); onData("\b \b"); }
          } else if (ch >= " ") {
            typed += ch;
            onData(ch);
          }
        }
      },
      writeBinary() {},
      resize() {},
      onData(callback) { onData = callback; },
      onClose() {},
      close() {},
    };
  }
}
