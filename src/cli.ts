#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const [, , cmd, ...rest] = process.argv;
if (cmd !== "record" || rest.length === 0) {
  console.error('usage: mockist record -- <your test command>\n  e.g. mockist record -- vitest weather-flow');
  process.exit(1);
}
const sep = rest.indexOf("--");
const testCmd = sep >= 0 ? rest.slice(sep + 1) : rest;
if (testCmd.length === 0) {
  console.error('usage: mockist record -- <your test command>');
  process.exit(1);
}
const result = spawnSync(testCmd[0]!, testCmd.slice(1), {
  stdio: "inherit",
  env: { ...process.env, MOCKIST_RECORD: "1" },
});
process.exit(result.status ?? 1);
