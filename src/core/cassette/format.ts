import type { Call, CallKind, RecordedEntry, RecordedError } from "../types";
import { isRedacted } from "./redact";

export const CASSETTE_FORMAT_VERSION = 1;

interface CassetteFile {
  mockist_format_version: number;
  recordedAt?: string;
  redactions?: string[];
  calls: RecordedEntry[];
}

/** Parse + validate a cassette file's text. Throws (with `path`) on any structural problem. */
export function parseCassette(text: string, path: string): RecordedEntry[] {
  let data: CassetteFile;
  try {
    data = JSON.parse(text) as CassetteFile;
  } catch (e) {
    throw new Error(`mockist: cassette "${path}" is not valid JSON: ${(e as Error).message}`);
  }
  if (data.mockist_format_version !== CASSETTE_FORMAT_VERSION) {
    throw new Error(
      `mockist: cassette "${path}" has unsupported mockist_format_version ${data.mockist_format_version} (expected ${CASSETTE_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(data.calls)) {
    throw new Error(`mockist: cassette "${path}" is missing a "calls" array`);
  }
  data.calls.forEach((entry, i) => {
    const hasOutput = "output" in entry;
    const hasError = "error" in entry;
    if (hasOutput === hasError) {
      throw new Error(`mockist: cassette "${path}" call [${i}] ("${entry.name}") must define exactly one of "output" or "error"`);
    }
  });
  return data.calls;
}

function toRecordedError(error: unknown): RecordedError {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}

function assertSerializable(value: unknown, where: string): void {
  const t = typeof value;
  if (t === "function" || t === "bigint" || t === "symbol") {
    throw new Error(`mockist: cannot serialize ${t} at ${where} — cassette values must be JSON-serializable`);
  }
  if (Array.isArray(value)) value.forEach((v, i) => assertSerializable(v, `${where}[${i}]`));
  else if (value && t === "object") for (const [k, v] of Object.entries(value)) assertSerializable(v, `${where}.${k}`);
}

function toEntry(call: Call, index: number): RecordedEntry {
  assertSerializable(call.input, `calls[${index}].input`);
  const entry: RecordedEntry = { name: call.name };
  if (call.kind !== "tool") entry.kind = call.kind as CallKind;
  if (call.input !== undefined) entry.input = call.input;
  if (call.error !== undefined) {
    entry.error = toRecordedError(call.error);
  } else {
    assertSerializable(call.output, `calls[${index}].output`);
    entry.output = call.output ?? null;
  }
  return entry;
}

/** Recursively sort object keys for deterministic, diff-friendly output. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

function manifest(calls: RecordedEntry[]): string[] {
  const paths: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") { if (isRedacted(v)) paths.push(path); return; }
    if (Array.isArray(v)) { v.forEach((item, i) => walk(item, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) walk(val, `${path}.${k}`);
  };
  calls.forEach((entry, i) => {
    walk(entry.input, `calls[${i}].input`);
    walk(entry.output, `calls[${i}].output`);
  });
  return paths;
}

/** Serialize a recorded trajectory to deterministic cassette JSON. Throws on non-serializable values. */
export function serializeCassette(calls: readonly Call[], opts: { now: string }): string {
  const entries = calls.map(toEntry);
  const file: CassetteFile = {
    mockist_format_version: CASSETTE_FORMAT_VERSION,
    recordedAt: opts.now,
    redactions: manifest(entries),
    calls: entries,
  };
  return JSON.stringify(sortKeys(file), null, 2);
}
