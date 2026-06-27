# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-06-27

First public release. M0–M2 are complete.

### Added

- **Core harness** — `createHarness`, declarative stubs, trajectory recording,
  sequential stubs, layered stub registries (`defineStubs`, first-match wins)
- **Vercel AI SDK adapter** — `wrapVercelTools`
- **Record → replay cassettes** — `MOCKIST_RECORD`, Vitest/Jest setup modules,
  redaction, match directives, coverage helpers
- **Trajectory assertions** — runner-agnostic helpers in `mockist` (`expectExactTrajectory`,
  `expectSubsequence`, `expectCalledTool`, etc.)
- **Multi-agent composition v1** — `mergeHarnessTrajectories`, `concatTrajectories`,
  `harness.recordCall` for handoff markers
- **SDK adapters** — Claude Agent SDK (`createClaudeAgentHooks`), MCP
  (`wrapMcpHandlers`, `createMcpClientInterceptor`), OpenAI (`wrapOpenAiTools`)
- **Schema-grounded stubs** — `stubsFromSchemas`, `validateStubsAgainstSchemas`,
  `validateTrajectoryOutputs`
- **Runner integrations** — `mockist/vitest-matchers`, `mockist/jest-matchers`
- **CLI** — `mockist record -- <test command>`
- **Examples** — per-SDK integration guides under `examples/`

### Notes

- Requires Node.js 22+ and peer dependencies `ai` ^6 and `zod` ^4
- Licensed under Elastic License 2.0 (source-available; see [LICENSE](LICENSE))

[0.1.0]: https://github.com/ydderd/mockist/releases/tag/v0.1.0
