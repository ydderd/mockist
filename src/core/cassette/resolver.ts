import type { RecordedEntry, Resolution, Resolver, ResolverInput } from "../types";
import { inputMatches } from "./match";

export interface CassetteResolver {
  resolve: Resolver;
  reset: () => void;
  entries: RecordedEntry[];
  state: () => { matched: ResolverInput[]; missed: ResolverInput[]; unused: RecordedEntry[] };
}

function produce(entry: RecordedEntry): Resolution {
  return {
    produce: () => {
      if (entry.error !== undefined) {
        const err = new Error(entry.error.message);
        err.name = entry.error.name;
        throw err;
      }
      return entry.output;
    },
  };
}

/** Build a consume-once resolver over an ordered list of recorded entries. */
export function createCassetteResolver(entries: RecordedEntry[]): CassetteResolver {
  let consumed = new Array(entries.length).fill(false) as boolean[];
  let matched: ResolverInput[] = [];
  let missed: ResolverInput[] = [];

  const resolve: Resolver = ({ kind, name, input }) => {
    for (let i = 0; i < entries.length; i++) {
      if (consumed[i]) continue;
      const entry = entries[i]!;
      if ((entry.kind ?? "tool") !== kind || entry.name !== name) continue;
      if (!inputMatches(entry, input)) continue;
      consumed[i] = true;
      matched.push({ kind, name, input });
      return produce(entry);
    }
    missed.push({ kind, name, input });
    return undefined;
  };

  return {
    resolve,
    entries,
    reset: () => {
      consumed = new Array(entries.length).fill(false);
      matched = [];
      missed = [];
    },
    state: () => ({
      matched: [...matched],
      missed: [...missed],
      unused: entries.filter((_, i) => !consumed[i]),
    }),
  };
}
