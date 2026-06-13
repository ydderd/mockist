import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Call, RecordedEntry } from "../types";
import { parseCassette, serializeCassette } from "./format";

/** Load + parse a cassette. A missing file warns once and yields no entries. */
export function loadCassetteEntries(path: string): RecordedEntry[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(
        `mockist: cassette "${path}" not found — no recorded calls loaded (all calls use the onUnhandled policy).`,
      );
      return [];
    }
    throw e;
  }
  return parseCassette(text, path);
}

/** Serialize and write a cassette, creating parent directories. */
export async function writeCassette(
  path: string,
  calls: readonly Call[],
  opts: { now: string },
): Promise<void> {
  const text = serializeCassette(calls, opts);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${text}\n`, "utf8");
}
