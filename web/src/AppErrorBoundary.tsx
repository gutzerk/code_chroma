import { Component, type ReactNode } from "react";
import { messageOf } from "./util/reportError";

/** Last-resort boundary around the canvas: a render-time throw in one view used to blank the whole
 * app with nothing but a console trace. This keeps the failure visible and offers a reload. */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: messageOf(error) };
  }

  componentDidCatch(error: unknown): void {
    console.error("[codechroma] render crashed:", error);
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div className="app-error-boundary" role="alert">
          <p>Something went wrong rendering the canvas.</p>
          <pre>{this.state.error}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
