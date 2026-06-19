#!/usr/bin/env node
/**
 * Emit a markdown summary of mockist cassette/trajectory test failures for PR comments.
 * Usage: node scripts/ci-trajectory-diff.mjs [vitest-json-output.json]
 * With no args, prints a placeholder when tests pass.
 */
import { readFileSync } from "node:fs";

const inputPath = process.argv[2];
const header = "## mockist test failures\n\n";

if (!inputPath) {
  console.log(`${header}All cassette/trajectory tests passed.`);
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (e) {
  console.error(`Failed to read vitest output: ${e}`);
  process.exit(1);
}

const failed = (payload.testResults ?? []).flatMap((file) =>
  (file.assertionResults ?? [])
    .filter((t) => t.status === "failed")
    .map((t) => ({ file: file.name, name: t.fullName ?? t.title, messages: t.failureMessages ?? [] })),
);

if (failed.length === 0) {
  console.log(`${header}All cassette/trajectory tests passed.`);
  process.exit(0);
}

const lines = [header, `**${failed.length} test(s) failed.**\n`];
for (const f of failed) {
  lines.push(`### ${f.name}`);
  lines.push(`\`${f.file}\`\n`);
  for (const msg of f.messages) {
    lines.push("```");
    lines.push(msg.slice(0, 4000));
    lines.push("```\n");
  }
}
console.log(lines.join("\n"));
process.exit(1);
