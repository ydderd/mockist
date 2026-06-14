import type { RecordedEntry } from "../types";
import { deepEqual } from "../deep-equal";
import { blankPaths, findRedactedPaths } from "./paths";

function ignorePathsFor(entry: RecordedEntry): string[] {
  const explicit =
    entry.match && typeof entry.match === "object" && Array.isArray(entry.match.ignore)
      ? entry.match.ignore
      : [];
  return [...explicit, ...findRedactedPaths(entry.input, "input")];
}

/** Does `input` match this entry's recorded input, honoring its match directive? */
export function inputMatches(entry: RecordedEntry, input: unknown): boolean {
  if (entry.match === "name") return true;
  const ignore = ignorePathsFor(entry);
  const a = blankPaths({ input: entry.input }, ignore);
  const b = blankPaths({ input }, ignore);
  return deepEqual(a, b);
}
