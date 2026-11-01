import { useEffect, useState } from "react";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { HierarchyNodeRef } from "../../state/types";

/** One function card inside an expanded sequence step. */
export interface StepFunction {
  nodeId: string;
  name: string;
  params?: string;
}

export interface StepFunctions {
  status: "idle" | "loading" | "ready" | "error";
  functions: StepFunction[];
  /** How many functions the linked code holds in all (the cards show the best few). */
  total: number;
  /** Calls between the shown cards, as [caller index, callee index]. */
  calls: Array<[number, number]>;
}

/** An expanded step shows six card slots: up to six functions, or five plus a "+ N more" card. */
export const STEP_FUNCTION_SLOTS = 6;
const MAX_CLASSES = 4;

interface ClientCaches {
  functions: Map<string, Promise<StepFunction[]>>;
  calls: Map<string, Promise<string[]>>;
}

// Per client, so another workspace's client never reads these lists; a "changed" ping clears them.
let cachesByClient = new WeakMap<EngineClient, ClientCaches>();

function cachesFor(client: EngineClient): ClientCaches {
  let caches = cachesByClient.get(client);
  if (!caches) {
    caches = { functions: new Map(), calls: new Map() };
    cachesByClient.set(client, caches);
  }
  return caches;
}

/** The card's second line: the signature, or the snippet's first line when the bridge sends none. */
const signatureOf = (node: HierarchyNodeRef): string | undefined =>
  node.params || node.source?.split("\n").map((line) => line.trim()).find(Boolean);

const toFunction = (node: HierarchyNodeRef): StepFunction => ({ nodeId: node.node_id, name: node.name, params: signatureOf(node) });

async function loadFunctions(client: EngineClient, nodeId: string): Promise<StepFunction[]> {
  const children = await client.getChildren(nodeId);
  const direct = children.filter((c) => c.level === "function");
  const classes = children.filter((c) => c.level === "class" && c.has_children).slice(0, MAX_CLASSES);
  const nested = await Promise.all(classes.map((c) => client.getChildren(c.node_id).catch(() => [])));
  return [...direct, ...nested.flat().filter((c) => c.level === "function")].map(toFunction);
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let hit = cache.get(key);
  if (!hit) {
    hit = load();
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

/** Splits identifiers and prose into lower-case words (`DiffManifest` → diff, manifest). */
export function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/** Orders functions by how many of their name's words the step's label and description share. */
export function rankFunctions(functions: StepFunction[], stepText: string): StepFunction[] {
  const words = new Set(wordsOf(stepText));
  const score = (f: StepFunction) =>
    wordsOf(f.name).filter((w) => words.has(w) || [...words].some((s) => s.startsWith(w) || w.startsWith(s))).length;
  return functions
    .map((f, index) => ({ f, index, score: score(f) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ f }) => f);
}

/** The cards an expanded step shows: the best-ranked functions that fit, leaving a slot for "+ more". */
export function pickStepFunctions(functions: StepFunction[], stepText: string): StepFunction[] {
  const ranked = rankFunctions(functions, stepText);
  return ranked.length <= STEP_FUNCTION_SLOTS ? ranked : ranked.slice(0, STEP_FUNCTION_SLOTS - 1);
}

/** Lazily loads the functions of a step's linked code and the calls between the shown ones. */
export function useStepFunctions(client: EngineClient, nodeId: string | null, stepText: string): StepFunctions {
  const [state, setState] = useState<StepFunctions>({ status: "idle", functions: [], total: 0, calls: [] });
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      client.subscribe(() => {
        cachesByClient.delete(client);
        setRevision((n) => n + 1);
      }),
    [client],
  );
  useEffect(() => {
    if (!nodeId) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading" }));
    const { functions: functionCache, calls: callCache } = cachesFor(client);
    void (async () => {
      try {
        const all = await cached(functionCache, nodeId, () => loadFunctions(client, nodeId));
        const shown = pickStepFunctions(all, stepText);
        const index = new Map(shown.map((f, i) => [f.nodeId, i]));
        const callees = await Promise.all(
          shown.map((f) =>
            cached(callCache, f.nodeId, async () => (await client.getConnections(f.nodeId)).filter((c) => c.from_id === f.nodeId).map((c) => c.to_id)).catch(() => []),
          ),
        );
        const calls: Array<[number, number]> = [];
        callees.forEach((targets, from) => {
          for (const target of targets) {
            const to = index.get(target);
            if (to !== undefined && to !== from) calls.push([from, to]);
          }
        });
        if (!cancelled) setState({ status: "ready", functions: shown, total: all.length, calls });
      } catch {
        if (!cancelled) setState({ status: "error", functions: [], total: 0, calls: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, nodeId, stepText, revision]);
  return state;
}

/** Test hook: forgets every cached function list and call list. */
export function clearStepFunctionCache(): void {
  cachesByClient = new WeakMap();
}
