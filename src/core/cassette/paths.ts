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

const BLANK = " mockist:ignored ";

/** Deep clone of `root` with each existing dotted path overwritten by a fixed token. */
export function blankPaths(root: unknown, paths: string[]): unknown {
  if (paths.length === 0) return root;
  const clone = structuredClone(root);
  for (const path of paths) {
    const tokens = parsePath(path);
    let cur: any = clone;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (cur == null || typeof cur !== "object") { cur = undefined; break; }
      cur = cur[tokens[i] as keyof typeof cur];
    }
    const last = tokens[tokens.length - 1];
    if (cur != null && typeof cur === "object" && last !== undefined && last in cur) {
      cur[last as keyof typeof cur] = BLANK;
    }
  }
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
