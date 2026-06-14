import { isRedacted } from "./redact";

export type PathToken = string | number;

/** Parse a dotted path with array indices: "a.b[0].c" -> ["a","b",0,"c"]. */
export function parsePath(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  for (const seg of path.split(".")) {
    const name = seg.match(/^[^[]+/)?.[0];
    if (name) tokens.push(name);
    for (const m of seg.matchAll(/\[(\d+)\]/g)) tokens.push(Number(m[1]));
  }
  return tokens;
}

function deleteAtPath(root: unknown, path: string): void {
  const tokens = parsePath(path);
  let cur: any = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (cur == null || typeof cur !== "object") return;
    cur = cur[tokens[i] as keyof typeof cur];
  }
  const last = tokens[tokens.length - 1];
  if (cur != null && typeof cur === "object" && last !== undefined && last in cur) {
    delete cur[last as keyof typeof cur];
  }
}

function cloneForBlanking(root: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (root === null || typeof root !== "object") return root;
  if (seen.has(root)) return seen.get(root);
  if (Array.isArray(root)) {
    const copy = root.map((item) => cloneForBlanking(item, seen));
    seen.set(root, copy);
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(root, copy);
  for (const [key, value] of Object.entries(root)) copy[key] = cloneForBlanking(value, seen);
  return copy;
}

function safeCloneForBlanking(root: unknown): unknown {
  try {
    return structuredClone(root);
  } catch {
    try {
      return JSON.parse(JSON.stringify(root));
    } catch {
      return cloneForBlanking(root);
    }
  }
}

/** Deep clone of `root` with each existing dotted path removed before comparison. */
export function blankPaths(root: unknown, paths: string[]): unknown {
  if (paths.length === 0) return root;
  const clone = safeCloneForBlanking(root);
  for (const path of paths) deleteAtPath(clone, path);
  return clone;
}

/** Dotted paths (rooted at `base`) whose string value is a redaction sentinel. */
export function findRedactedPaths(value: unknown, base: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      if (isRedacted(v)) out.push(path);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) walk(val, `${path}.${k}`);
    }
  };
  walk(value, base);
  return out;
}
