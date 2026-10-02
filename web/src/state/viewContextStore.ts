import { useSyncExternalStore } from "react";
import { Store } from "./createStore";
import type { ViewContext } from "../agents/viewContext";

/** The current view context, kept up to date by the active view and read by the agent-launch
 *  buttons ("Run agent" / "Add agent here"). Each view owns its own data, so each view reports its
 *  context into this store rather than RootCanvas trying to re-derive diagram details it never
 *  loads. RootCanvas drives the *lifecycle*: it sets a base context when the view changes and clears
 *  it on workspace switch, and the view overwrites it with rich detail (epic title/source, C1 system
 *  name, patterns count, custom title) once its own data is in hand.
 *
 *  Registered as a workspace store so a switch drops any stale view description — an epic id from
 *  one repo means nothing in another (mirrors epicsFocusStore). */
class ViewContextStore extends Store {
  private current: ViewContext | null = null;

  get = (): ViewContext | null => this.current;

  /** Content-aware, so a view can re-report on every render (cheap) and this stays a no-op unless the
   *  description actually changed — reference equality would emit on every render, and comparing
   *  just against `null` would silently drop a change that only tightened the wording. */
  set = (value: ViewContext | null): void => {
    if (sameContext(value, this.current)) return;
    this.current = value;
    this.emit();
  };

  reset = (): void => {
    this.current = null;
    this.emit();
  };
}

export const viewContextStore = new ViewContextStore();

export function useCurrentViewContext(): ViewContext | null {
  return useSyncExternalStore(viewContextStore.subscribe, viewContextStore.get);
}

/** Whether two contexts carry the same description + workspace — the only fields the agent reads. */
function sameContext(a: ViewContext | null, b: ViewContext | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.workspace === b.workspace && a.description === b.description;
}
