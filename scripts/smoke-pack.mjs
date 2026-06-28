#!/usr/bin/env node
/**
 * Smoke-test the npm tarball the way consumers install it.
 * Packs the repo, installs the .tgz in a temp project, and verifies dist exports.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd ?? root,
    env: opts.env ?? process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: opts.cwd ?? root,
    env: opts.env ?? process.env,
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return (result.stdout ?? "").trim();
}

console.log("smoke-pack: building dist/");
run("npm", ["run", "build"]);

console.log("smoke-pack: creating tarball");
const packOutput = runCapture("npm", ["pack", "--silent"]);
const tarball = packOutput.split("\n").pop();
if (!tarball?.endsWith(".tgz")) {
  console.error(`smoke-pack: expected .tgz from npm pack, got: ${packOutput}`);
  process.exit(1);
}
const tarballPath = resolve(root, tarball);

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const workdir = mkdtempSync(join(tmpdir(), "mockist-smoke-"));

try {
  writeFileSync(
    join(workdir, "package.json"),
    JSON.stringify(
      {
        name: "mockist-smoke-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@ydderd/mockist": `file:${tarballPath}`,
          ai: "*",
          zod: "*",
        },
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(workdir, "smoke.mjs"),
    `import { createHarness, wrapVercelTools, expectCalledTool } from "@ydderd/mockist";
import { createRequire } from "node:module";

const harness = createHarness({ stubs: [{ name: "ping", result: "pong" }] });
const wrapped = wrapVercelTools({ ping: { execute: async () => "real" } }, harness);
const output = await wrapped.ping.execute({});
if (output !== "pong") throw new Error(\`expected pong, got \${output}\`);
const { pass } = expectCalledTool(harness.trajectory, "ping");
if (!pass) throw new Error("expectCalledTool failed");

// Subpath exports resolve in the tarball (matchers/setup pull vitest/jest at runtime).
const require = createRequire(import.meta.url);
for (const subpath of [
  "@ydderd/mockist/vitest-setup",
  "@ydderd/mockist/jest-setup",
  "@ydderd/mockist/vitest-matchers",
  "@ydderd/mockist/jest-matchers",
]) {
  require.resolve(subpath);
}

console.log("smoke-pack: @ydderd/mockist@${version} tarball imports OK");
`,
  );

  console.log(`smoke-pack: installing tarball in ${workdir}`);
  run("npm", ["install", "--no-fund", "--no-audit"], { cwd: workdir });
  run("node", ["smoke.mjs"], { cwd: workdir });
} finally {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(tarballPath, { force: true });
}

console.log("smoke-pack: passed");
