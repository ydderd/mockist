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

const failed = (payload.testResults ?? []).flatMap((file) => {
  const fileFailures = [];
  if (file.status === "failed" && (file.assertionResults ?? []).length === 0) {
    fileFailures.push({
      file: file.name,
      name: file.name,
      messages: [file.message ?? "Test file failed to run (no assertion results)."],
    });
  }
  for (const t of file.assertionResults ?? []) {
    if (t.status !== "failed") continue;
    fileFailures.push({
      file: file.name,
      name: t.fullName ?? t.title,
      messages: t.failureMessages ?? [],
    });
  }
  return fileFailures;
});

const suiteFailed = payload.success === false && failed.length === 0;
if (failed.length === 0 && !suiteFailed) {
  console.log(`${header}All cassette/trajectory tests passed.`);
  process.exit(0);
}

const lines = [header];
if (suiteFailed) {
  lines.push(
    "**Test run failed** (Vitest reported `success: false` but no per-test failures were captured).\n",
  );
  if (payload.numFailedTests != null) {
    lines.push(`Failed tests: ${payload.numFailedTests}\n`);
  }
} else {
  lines.push(`**${failed.length} test(s) failed.**\n`);
  for (const f of failed) {
    lines.push(`### ${f.name}`);
    lines.push(`\`${f.file}\`\n`);
    for (const msg of f.messages) {
      lines.push("```");
      lines.push(msg.slice(0, 4000));
      lines.push("```\n");
    }
  }
}
console.log(lines.join("\n"));
// Exit 0 so the workflow summary/comment steps always run; job failure is handled separately.
process.exit(0);
