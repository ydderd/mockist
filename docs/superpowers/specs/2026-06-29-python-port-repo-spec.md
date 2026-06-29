# mockist-py repo spec

Status: proposed starting spec for a separate Python repository. Authority: this repo
(`ydderd/mockist`) remains the product and cassette-format source of truth until a shared
spec repo exists.

## Goal

Build the Python equivalent of mockist: a small, local-first test harness for agent
tool/skill boundaries. It should let Python users stub whole tool calls, record/replay
tool-boundary runs as cassettes, and assert the trajectory of calls made by an agent.

This is a separate package/repo, likely:

- GitHub repo: `ydderd/mockist-py` or `ydderd/mockist-python`
- PyPI package: `mockist` if available, else `mockist-py`
- Import package: `mockist`

The Python package should feel native to Python test suites, but it should preserve the
core product idea and cassette compatibility with the TypeScript package wherever practical.

## Product Scope

mockist-py tests the **agentic tool/skill call boundary**:

- Did the agent call the right tool/skill?
- Did it pass the expected args?
- Did it call tools in the expected order?
- Did it handle a stubbed tool result or tool error?
- Can a real boundary run be recorded once and replayed deterministically in tests?

It does **not** mock DB/HTTP/queue/filesystem calls inside a tool implementation. If the
developer owns the tool body, they should unit-test that implementation with normal Python
tools such as `pytest`, `unittest.mock`, `responses`, `respx`, `pytest-httpx`, `vcrpy`,
or testcontainers.

## MVP Requirements

### Core Harness

Provide a runner-agnostic harness:

```py
from mockist import create_harness

harness = create_harness(
    stubs=[
        {"name": "get_weather", "args": {"city": "Paris"}, "result": {"temp_c": 21}},
    ],
    on_unhandled="error",
)
```

Required behavior:

- `create_harness(...)` returns a `Harness`.
- `Harness.dispatch(kind, name, input, original)` routes one boundary call.
- `kind` is one of `"tool"`, `"skill"`, `"subagent"`, defaulting to `"tool"`.
- Matching stub returns a canned `result`.
- Matching stub with `error` raises that error.
- Unmatched call obeys `on_unhandled`:
  - `"passthrough"`: run `original`
  - `"warn"`: warn, then run `original`
  - `"error"`: raise a clear mockist error
- Every call records a trajectory entry, whether stubbed or passthrough.

Trajectory entry shape:

```py
{
    "kind": "tool",
    "name": "get_weather",
    "input": {"city": "Paris"},
    "output": {"temp_c": 21},      # present on success
    "error": None,                 # present or non-null on failure
    "stubbed": True,
    "ts": 1780000000.0,
    "key": "...stable identity...",
}
```

The exact Python representation can be a dataclass, TypedDict, or plain dict, but public
attributes should be easy to inspect in `pytest` assertions.

### Stub Matching

Support the same stub concepts as TypeScript:

```py
stubs = [
    {"name": "get_weather", "args": {"city": "Paris"}, "result": {"temp_c": 21}},
    {"name": "search", "match": lambda i: "docs" in i["q"], "result": {"hits": []}},
    {"name": "flaky", "result": lambda _input: (_ for _ in ()).throw(RuntimeError("503"))},
    {"name": "now", "result": "2026-06-29T00:00:00Z"},
]
```

Rules:

- Match on `kind` + `name`.
- If `match` predicate is present, it decides whether the stub matches.
- Else if `args` is present, deep-equal against input.
- Else match by name only.
- First matching stub wins.
- Stub result may be a literal or callable.
- Callable result receives the input and may be sync or async.

### Sequential Stubs

Support ordered outcomes for retry/polling/failure-then-success tests:

```py
harness = create_harness(stubs=[{
    "name": "search",
    "args": {"q": "billing"},
    "sequence": [
        {"error": TimeoutError("timeout")},
        {"result": {"hits": ["doc-1"]}},
    ],
    "on_sequence_exhausted": "error",
}])
```

Required exhaustion modes:

- `"error"`: default, raise a mockist sequence-exhausted error
- `"repeat-last"`: keep serving the final sequence step
- `"passthrough"`: run the real tool after the sequence is consumed

Expose:

```py
harness.sequence_state()
```

with per-stub `{name, kind, length, consumed, exhausted}`.

### Assertions

Provide pure assertion helpers that return result objects, not pytest-specific exceptions:

```py
from mockist import expect_exact_trajectory, expect_called_with

result = expect_exact_trajectory(harness.trajectory, [
    {"name": "get_weather", "input": {"city": "Paris"}, "stubbed": True},
])
assert result.pass_, result.message()
```

Required helpers:

- `expect_exact_trajectory(trajectory, expected)`
- `expect_subsequence(trajectory, expected)`
- `expect_called_tool(trajectory, name)`
- `expect_called_with(trajectory, name, partial_input)`
- `expect_no_unhandled_calls(trajectory)`
- `expect_no_passthrough_calls(trajectory)`
- `expect_no_exhausted_sequences(sequence_state)`
- `expect_cassette_fully_used(cassette_state)`
- `cassette_expected_calls(harness)`

Failure messages should be readable in CI and include expected-vs-actual call details.

Optional pytest plugin:

```py
def test_weather(mockist_assert):
    mockist_assert.called_tool(harness, "get_weather")
```

Do not make pytest a hard dependency for the core package.

## Cassette Requirements

mockist-py must read and write TypeScript-compatible cassette format version 1.

Example:

```json
{
  "mockist_format_version": 1,
  "recordedAt": "2026-06-29T18:04:00Z",
  "redactions": [
    "calls[0].input.headers.authorization"
  ],
  "calls": [
    {
      "name": "search",
      "input": { "q": "billing" },
      "output": { "hits": ["doc-1"] }
    },
    {
      "name": "search",
      "input": { "q": "billing", "requestId": "[REDACTED:requestId]" },
      "error": { "name": "TimeoutError", "message": "upstream timeout" },
      "match": { "ignore": ["input.requestId"] }
    },
    {
      "name": "now",
      "output": "2026-06-29T00:00:00Z",
      "match": "name"
    }
  ]
}
```

Format rules:

- Top-level `mockist_format_version` must equal `1`.
- Top-level `calls` must be an ordered list.
- Each call has `name`, optional `kind`, optional `input`, exactly one of `output` or `error`,
  and optional `match`.
- `kind` defaults to `"tool"`.
- `match` omitted means name + deep-equal input.
- `match: "name"` means name-only.
- `match: {"ignore": ["input.requestId"]}` ignores dotted paths during matching.
- Redaction sentinel strings of form `[REDACTED:<field>]` are automatic wildcards at replay.
- Replay matching is consume-once: scan cassette order for the first unconsumed matching entry.
- Recording writes deterministic JSON with sorted object keys and 2-space indent.
- Missing cassette file in replay mode should warn and behave as an empty overlay.
- Malformed cassette file should raise at harness creation.

Record mode:

- Triggered by `MOCKIST_RECORD` environment variable.
- In record mode, real tools run and the cassette is overwritten on save/flush.
- `on_unhandled="error"` is ignored during record mode so new cassettes can be captured.
- Provide `harness.save()` for explicit writes.
- Provide a pytest integration that auto-saves registered harnesses after tests when recording.

Redaction:

- Default redactor replaces values whose key matches secret-bearing names:
  `authorization`, `api_key`, `apikey`, `token`, `password`, `secret`, `cookie`, `set-cookie`.
- Redacted values use `[REDACTED:<key>]`.
- Apply redaction to inputs and outputs.
- Do not redact error messages by default.
- Allow custom redactor injection.

## Adapter Requirements

### MVP Adapter Priority

Start with adapters that map naturally to Python:

1. Generic callable/tool registry adapter
2. OpenAI Agents SDK adapter, if the current Python SDK exposes a stable tool boundary
3. LangChain tool adapter
4. MCP Python SDK server/client adapter
5. Optional: LlamaIndex tools, CrewAI, PydanticAI, AutoGen

Do not block the MVP on every adapter. The core harness plus one real adapter is enough for
the first release.

### Generic Callable Adapter

Provide a framework-neutral wrapper first:

```py
from mockist import wrap_tools

tools = {
    "get_weather": get_weather,  # callable accepting one input dict, or **kwargs if configured
}

wrapped = wrap_tools(tools, harness)
result = await wrapped["get_weather"]({"city": "Paris"})
```

Requirements:

- Preserve sync and async callables.
- Preserve function names where practical.
- Route calls through `harness.dispatch("tool", name, input, original)`.
- Support maps of `name -> callable`.
- Optionally support objects with `.run`, `.invoke`, `.ainvoke`, or `__call__` later.

### OpenAI Python Adapter

If targeting OpenAI's Python agent/tool surface, prefer a thin wrapper around the local tool
callback boundary rather than trying to intercept network calls.

Potential API:

```py
from mockist.adapters.openai import wrap_openai_tools

tools = wrap_openai_tools(my_tools, harness)
```

Requirements:

- Use structural checks to avoid hard dependency where possible.
- Preserve original tool metadata.
- Route only the executable tool callback through mockist.
- For SDK APIs without local executable callbacks, provide an interceptor helper:

```py
interceptor = create_openai_tool_interceptor(harness)
result = await interceptor.call_tool("get_weather", {"city": "Paris"}, original)
```

### MCP Python Adapter

Wrap server handlers and client calls at `tools/call` boundaries.

Potential APIs:

```py
from mockist.adapters.mcp import wrap_mcp_handlers, create_mcp_client_interceptor

handlers = wrap_mcp_handlers({"search": search_handler}, harness)
client = create_mcp_client_interceptor(harness, call_tool=real_call_tool)
```

Requirements:

- Normalize MCP call arguments into the same `input` shape recorded by the harness.
- Preserve handler return values.
- Avoid mocking MCP transport internals.

## Repository Layout

Recommended:

```text
mockist-py/
  pyproject.toml
  README.md
  LICENSE
  src/mockist/
    __init__.py
    harness.py
    registry.py
    assertions.py
    cassette/
      __init__.py
      format.py
      replay.py
      record.py
      redact.py
      paths.py
    adapters/
      __init__.py
      generic.py
      openai.py
      mcp.py
      langchain.py
    pytest_plugin.py
    types.py
  tests/
    test_harness.py
    test_sequence.py
    test_assertions.py
    test_cassette_record_replay.py
    test_redaction.py
    test_generic_adapter.py
    test_openai_adapter.py
    test_mcp_adapter.py
  examples/
    generic/
    openai/
    mcp/
    langchain/
```

Packaging:

- Python `>=3.10` or `>=3.11`; choose `>=3.10` if dependency support is easy.
- Use `pyproject.toml`.
- Recommended tooling: `uv`, `ruff`, `pytest`, `pytest-asyncio`, `mypy` or `pyright`.
- Core dependencies should be minimal. SDK integrations should be optional extras:
  - `mockist[openai]`
  - `mockist[mcp]`
  - `mockist[langchain]`
  - `mockist[pytest]`

## Public API Sketch

```py
from mockist import (
    Harness,
    create_harness,
    define_stubs,
    wrap_tools,
    expect_exact_trajectory,
    expect_subsequence,
    expect_called_tool,
    expect_called_with,
    expect_no_unhandled_calls,
    expect_no_passthrough_calls,
    expect_no_exhausted_sequences,
    expect_cassette_fully_used,
    cassette_expected_calls,
)
```

Python naming should be snake_case, while cassette JSON fields stay compatible with the
TypeScript package (`mockist_format_version`, `recordedAt`, `calls`, `match`, etc.).

## Test Plan

Core tests:

- exact args stub returns canned result and does not call real function
- predicate stub matches
- name-only stub matches
- first-match-wins across layered stub arrays
- unmatched passthrough records `stubbed=False`
- unmatched warn records and warns
- unmatched error raises and records or surfaces a clear error
- throwing stub records error
- async result callable works
- async original callable works
- sequence error-then-success works
- sequence exhausted modes work
- `reset()` clears trajectory, sequence cursors, and cassette consumption

Cassette tests:

- record writes format version 1
- replay serves cassette output without calling real function
- replay reconstructs errors
- consume-once matching supports repeated calls
- `match: "name"` ignores input
- `match.ignore` ignores dotted paths
- redacted input sentinel wildcards
- malformed cassette raises
- missing cassette warns and falls through
- `expect_cassette_fully_used` reports missed and unused entries

Adapter tests:

- generic sync callable wrapper
- generic async callable wrapper
- OpenAI adapter with local fake tool object or callback
- MCP handler wrapper with local fake handler
- no live API keys required

Compatibility tests:

- Add shared fixture cassettes copied from TypeScript and assert Python can replay them.
- Add Python-generated fixture and assert TypeScript can parse/replay it later, if both repos
  are available in CI.

## Milestones

### M0 - Core Harness

- Package skeleton
- `create_harness`
- stubs, passthrough/warn/error
- trajectory recording
- generic callable adapter
- core assertion helpers
- pytest tests

Exit criterion: a Python test can wrap a callable tool map, stub a result/error, and assert
the exact trajectory.

### M1 - Cassettes

- format v1 parser/writer
- record/replay mode
- redaction
- cassette state
- cassette assertion helpers
- pytest auto-save integration

Exit criterion: record a real callable-tool run once, then replay it without calling the real
tool, using a cassette that TypeScript mockist can understand in principle.

### M2 - Real Adapter Dogfood

- One real SDK adapter, preferably OpenAI Agents Python or MCP Python
- One public example
- One dogfood PR or branch against a real Python agent repo

Exit criterion: a developer using that SDK can add mockist-py to an existing test with one
small wrapper and get useful trajectory assertions.

### M3 - Ecosystem Adapters

- LangChain
- MCP server + client polish
- LlamaIndex / PydanticAI / CrewAI / AutoGen only if pulled by real user demand

## Documentation Requirements

README should include:

- one-sentence problem statement
- installation
- complete pytest quick start
- stubbed error example
- cassette record/replay example
- adapter table
- explicit "what mockist does not test" section
- link back to TypeScript mockist for product background and cassette format

Examples should be runnable without live API keys unless explicitly labeled as live-recording
examples.

## Non-Goals

- Do not build an eval dashboard.
- Do not intercept HTTP/DB calls inside tools.
- Do not create a separate declarative capability-spec DSL.
- Do not require pytest for the core harness.
- Do not require every agent SDK as a hard dependency.
- Do not chase every Python agent framework before one adapter has real dogfood.

## Open Questions

- Package name availability on PyPI: `mockist` vs `mockist-py`.
- First real adapter target: OpenAI Agents Python, MCP Python, or LangChain.
- Whether to keep cassette field `recordedAt` camelCase for TS compatibility even though
  Python APIs use snake_case. Recommendation: yes.
- Whether the license should match this repo's Elastic License 2.0. Recommendation: yes,
  unless distribution strategy changes before repo creation.
- Whether to create a future `mockist-spec` repo for cassette fixtures and cross-language
  compatibility tests. Recommendation: defer until both packages exist.
