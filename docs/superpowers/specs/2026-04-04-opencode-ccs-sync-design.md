# opencode-ccs-sync Design

Date: 2026-04-04

## Goal

Build a production-quality TypeScript/Bun integration for OpenCode that synchronizes CCS-managed providers and models into `opencode.jsonc` safely, idempotently, and with minimal surface area.

The implementation should stay plugin-first and as simple as possible:

- primary artifact: an OpenCode plugin
- managed scope: providers and models prefixed with `ccs-`
- config edits: preserve JSONC comments and unrelated settings
- model source: CCS config + CLIProxy model discovery
- verification: unit-tested with Vitest

This design intentionally avoids a standalone CLI wrapper unless watch-mode requirements prove that a separate runtime entrypoint is necessary for correct functioning.

## User-Approved Constraints

- Treat this as an OpenCode plugin, not a large standalone tool.
- Keep the design as simple as possible.
- Support multiple CCS providers in one sync run.
- Consider any OpenCode provider or model entry prefixed with `ccs-` to be managed by this system.
- Do not mutate unrelated OpenCode config entries.
- Preserve JSONC comments and unrelated formatting as much as practical.
- Retry indefinitely while CLIProxy is unavailable.
- Prefer silent JSON-friendly result objects for tool output.
- Add unit tests and verify them with Vitest.
- Do not add a thin CLI wrapper unless it is required for correct functioning.

## Recommended Architecture

### Chosen approach

Use a small OpenCode plugin that exposes one sync-oriented tool backed by a shared sync service.

The plugin is responsible for orchestrating:

1. locating OpenCode and CCS config files
2. loading and normalizing CCS configuration
3. discovering models from CLIProxy for one or more providers
4. patching `opencode.jsonc` with `jsonc-parser`
5. returning a deterministic JSON result for OpenCode use

This keeps the public surface area small while still allowing all important logic to live in testable modules.

### Alternatives considered

#### 1. Standalone CLI-first application

Pros:

- easy to run directly from shell
- watch mode is straightforward

Cons:

- adds avoidable runtime surface
- moves away from the requested plugin-first OpenCode integration
- encourages duplication between CLI behavior and plugin behavior

Decision: rejected as the primary design.

#### 2. Per-provider plugin modules

Pros:

- strong separation between providers

Cons:

- unnecessary abstraction for the current scope
- more files and coordination for little gain

Decision: rejected for v1 because it complicates a problem that can be solved with a single service plus clear data transforms.

## Runtime Shape

### Primary runtime

`src/index.ts` exports the OpenCode plugin.

## OpenCode Plugin Contract

The integration contract with OpenCode must be explicit and stable.

### Entrypoint

- plugin entrypoint: `src/index.ts`
- the module must expose the plugin from the default export
- the default export must conform to the OpenCode plugin contract used by `@opencode-ai/plugin`

Conceptually, implementation should look like:

```ts
import type { Plugin } from '@opencode-ai/plugin';

const plugin: Plugin = async () => ({
  tools: {
    ccs_sync: {
      // schema + handler
    },
  },
});

export default plugin;
```

The exact TypeScript typing details can follow the package API, but the external behavior must match this shape:

- one plugin entrypoint
- one registered tool named `ccs_sync`
- no interactive flows
- deterministic JSON-safe execution

### Tool registration

The plugin must register a single tool:

- name: `ccs_sync`

No additional tools should be added in v1 unless a hard implementation need appears.

### Tool input contract

The tool must accept a structured object input. The exact schema may be refined during implementation, but it must remain machine-oriented and non-interactive.

Expected fields:

- `opencodeConfigPath?`: explicit OpenCode config file path
- `ccsConfigPath?`: explicit CCS config file path
- `providers?`: list of CCS provider IDs to sync
- `includeModelFamilies?`: optional allowlist filter
- `dryRun?`: boolean
- `watch?`: boolean

Rules:

- no positional-only or freeform text parsing
- no interactive prompts
- all inputs must be representable as JSON

### Tool output contract

The tool must return structured JSON output only.

Minimum output shape should include:

- `ok`: boolean
- `mode`: `sync` or `watch`
- `changed`: boolean
- `resolvedPaths`
- `providers`
- `defaultModel?`
- `summary`
- `errors?`

Rules:

- no interactive prompts
- no human-only logging mixed into return values
- any logging emitted during execution must not corrupt structured output
- the tool must be safe for use inside OpenCode agents and automation flows

The plugin exposes a single tool, conceptually `ccs_sync`, which accepts a compact argument object such as:

- `opencodeConfigPath?`
- `ccsConfigPath?`
- `providers?`
- `dryRun?`
- `includeModelFamilies?`
- `watch?`

The exact tool schema may vary slightly during implementation, but the behavior must remain deterministic and script-friendly.

## Canonical OpenCode Config Structure

The implementation must target one canonical OpenCode config structure and must not invent a different shape.

The canonical managed structure is:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-ccs-sync"],
  "provider": {
    "ccs-claude": {
      // provider-specific transport/config fields as required by OpenCode
      // implementation must preserve existing unrelated sibling providers
    },
    "ccs-codex": {
      // provider-specific transport/config fields as required by OpenCode
    },
  },
  "model": "ccs-claude/claude-sonnet-4",
  "models": {
    "ccs-claude/claude-sonnet-4": {
      "provider": "ccs-claude",
      "id": "claude-sonnet-4",
    },
    "ccs-codex/gpt-5.4": {
      "provider": "ccs-codex",
      "id": "gpt-5.4",
    },
  },
}
```

Canonical rules:

- OpenCode has one global `model` field
- the global `model` field format must be `<provider>/<model-id>`
- managed provider names must be `ccs-<provider>`
- managed model keys must be `<ccs-provider>/<model-id>`
- model records must retain `provider` and `id`
- unrelated providers, models, comments, and settings must be preserved

If OpenCode requires additional provider-specific fields in `provider.ccs-*`, the implementation must add them in the same canonical structure rather than inventing a parallel layout.

### Watch mode

Watch mode is required by the original request, but it should not force a CLI wrapper by default.

The preferred order is:

1. implement watch behavior as part of the shared runtime if it can be done cleanly inside the plugin/tool flow
2. only introduce a small runtime entrypoint if watch mode truly requires a long-lived process outside normal plugin execution semantics

If a standalone watcher entrypoint becomes necessary, it must call the same sync service used by the plugin rather than duplicating logic.

If the plugin contract cannot safely host a long-running process, the implementation may introduce a minimal runtime entrypoint solely for watch mode. That runtime must:

- delegate all sync logic to the shared sync service
- avoid any duplicated config, discovery, or patch logic
- preserve the same structured result behavior where applicable

## Module Layout

The implementation should stay focused and modular.

```text
src/
  index.ts
  config/
    paths.ts
    ccs.ts
  cliproxy/
    client.ts
  opencode/
    patch.ts
  sync/
    service.ts
  watch/
    watch.ts             # only if required for correct functioning
  utils/
    backoff.ts
    fs.ts
    home.ts
    result.ts
```

No separate `opencode/read.ts` is needed unless implementation reveals a real boundary that improves clarity.

No `src/cli.ts` should be added unless watch mode cannot be supported correctly without it.

## Data Flow

### Sync flow

1. resolve paths for OpenCode config and CCS config
2. read CCS config from YAML
3. normalize CCS runtime settings and provider selection
4. query CLIProxy model endpoints for each selected provider
5. deduplicate and sort model IDs deterministically
6. choose default model for each managed provider
7. patch `opencode.jsonc` using JSONC edit operations
8. write the updated config unless running in dry-run mode
9. return a structured JSON result summarizing the effective changes

### Watch flow

If watch mode is implemented, it should:

1. observe the CCS config path and optionally the OpenCode config path
2. debounce rapid changes
3. execute the same sync flow
4. suppress self-induced write loops using content hashing or a write guard
5. keep running until explicitly stopped

## Path Resolution

### OpenCode config

Resolve in this order:

1. explicit tool argument path
2. `./opencode.jsonc`
3. `~/.config/opencode/opencode.jsonc`

If only `opencode.json` exists where the implementation is looking, the runtime may support that as a fallback if doing so stays simple and does not complicate tests. The default target remains `opencode.jsonc`.

### CCS config

Resolve in this order:

1. explicit tool argument path
2. `~/.ccs/config.yaml`

All home-directory expansion must be cross-platform and testable.

## Cross-Platform Requirements

The implementation must explicitly support:

- Linux
- macOS
- Windows

Cross-platform rules:

- no hardcoded POSIX-only paths
- no shell-specific assumptions
- home directory resolution must use runtime-safe APIs rather than string concatenation assumptions
- path joining and normalization must use proper path utilities
- file watching must work across supported platforms
- path separator differences must not affect correctness

## CCS Config Normalization

The CCS loader should convert YAML input into a normalized internal shape with explicit defaults.

Normalized fields should include at least:

- CLIProxy base URL / runtime URL
- bearer token (defaulting to `ccs-internal-managed` unless a better in-config source exists)
- default provider, if declared
- selected provider set for sync
- Anthropic preference fields such as `ANTHROPIC_MODEL` when present

Normalization rules:

- environment-style values should be supported where practical
- missing optional fields should fall back predictably
- malformed YAML or unreadable config should fail fast with a descriptive error

## Model Discovery

### Endpoint format

For each selected provider, query:

`/api/provider/{provider}/v1/models`

using:

`Authorization: Bearer ccs-internal-managed`

unless the normalized config provides a different valid internal token source.

### Discovery behavior

For each provider:

- fetch the model payload
- extract model IDs
- discard invalid or empty IDs
- deduplicate IDs
- apply optional include-family filtering
- sort deterministically using ascending lexicographic sort by raw model ID

The output for OpenCode should register the provider under the managed name:

- CCS provider `codex` becomes OpenCode provider `ccs-codex`
- CCS provider `claude` becomes OpenCode provider `ccs-claude`

### Retry policy

Transient CLIProxy availability failures must retry indefinitely.

Recommended behavior:

- start at roughly 1 second delay
- back off gradually up to roughly 30 seconds
- retry indefinitely for connection failures and CLIProxy unavailable conditions
- do not retry indefinitely for invalid config, malformed local state, or 4xx responses
- non-retryable local failures must fail fast with structured errors

## Default Model Selection

OpenCode has exactly one global default `model`.

There are no per-provider default model fields in this design.

Default model selection must therefore be deterministic across all managed providers.

Rule order:

1. for each selected provider, build its managed provider name `ccs-<provider>` and its sorted model list
2. choose the default provider deterministically by ascending lexicographic sort of managed provider name
3. within that provider, if `ANTHROPIC_MODEL` exists in normalized CCS config and is present in that provider's discovered model list, use it
4. otherwise use the first model in that provider's ascending lexicographically sorted model list
5. write the OpenCode global default as `"<provider>/<model-id>"`

Example:

- provider: `ccs-claude`
- model id: `claude-sonnet-4`
- final OpenCode `model`: `ccs-claude/claude-sonnet-4`

This rule should be implemented in a pure helper so it is trivial to test.

## OpenCode Config Patching

### Core rule

Use `jsonc-parser` edit operations (`modify`, `applyEdits`, and related helpers) instead of full parse-stringify rewriting.

This is required to preserve:

- comments
- unrelated formatting as much as possible
- unrelated configuration sections

### Ownership boundary

Only mutate entries owned by this system.

Ownership is defined by the `ccs-` prefix.

Safe operations:

- add missing managed providers named `ccs-*`
- update existing managed providers named `ccs-*`
- remove stale managed providers named `ccs-*` that are no longer produced by the current sync input
- update managed model references associated with managed providers

Forbidden operations:

- changing unrelated non-`ccs-` providers
- changing unrelated model or provider settings not owned by the sync process
- deleting unrelated comments or config sections

### Idempotency

Running sync twice with the same inputs should produce no effective second change.

Dry-run output should clearly report whether any changes would be made.

## Error Handling

### Fail fast

Fail immediately for:

- unreadable config files
- invalid YAML/JSONC structure that prevents safe processing
- unsupported local file permission issues
- invalid explicit input paths

### Retry forever

Retry indefinitely for:

- CLIProxy not yet available
- network connection failures to CLIProxy

Do not retry indefinitely for:

- invalid config
- malformed local files
- 4xx HTTP responses

### Result shape

The plugin tool should return a structured result object suitable for silent JSON consumption, for example:

- resolved paths
- selected providers
- discovered model counts
- changed / unchanged status
- dry-run summary
- retry metadata if relevant

The implementation can refine exact field names, but the shape must remain stable and machine-readable.

## Agent and Skill Execution Constraints

Assume the plugin will run inside OpenCode agents and skill-driven automation.

The runtime must therefore obey these constraints:

- no interactive prompts
- deterministic execution for identical inputs
- JSON-safe output
- logging must not break structured output
- dry-run mode must be supported
- tool behavior must remain automation-friendly and non-conversational

## Testing Strategy

Vitest unit tests are mandatory.

Minimum required coverage:

1. path resolution
   - explicit path wins
   - project `./opencode.jsonc` fallback
   - global OpenCode fallback
   - home expansion works in a cross-platform-safe way

2. CCS config normalization
   - YAML fields normalize correctly
   - environment-style values are respected
   - defaults are applied predictably

3. model extraction and filtering
   - deduplication works
   - deterministic sorting works
   - include-family filtering behaves correctly

4. ownership boundary
   - only `ccs-*` entries are updated or removed
   - unrelated config entries remain untouched

5. JSONC preservation
   - comments survive patching
   - unrelated fields survive patching

6. default model selection
   - `ANTHROPIC_MODEL` wins when discovered
   - fallback is the first sorted model

7. dry-run behavior
   - no writes occur
   - structured plan/result is returned

8. idempotency
   - second sync of the same state produces no effective changes

9. retry behavior
   - connection failures and CLIProxy unavailable continue retry scheduling
   - invalid config and 4xx responses do not retry forever

10. default model synthesis

- one global OpenCode `model` is produced
- format is always `<provider>/<model-id>`
- provider choice is deterministic

11. watch protections

- write-loop prevention suppresses self-triggered infinite resync
- watch logic reuses the shared sync service

The tests should favor pure functions and injected filesystem/network seams over heavy end-to-end scaffolding.

## Documentation

The project README should be replaced with documentation for this plugin, including:

- what the plugin does
- how managed `ccs-*` entries work
- required config assumptions
- how sync and watch mode behave
- how to run tests

README work belongs to the implementation phase, not this design phase.

## Non-Goals for v1

The first version should not expand into these areas unless implementation proves they are necessary:

- a rich multi-command CLI
- provider-specific plugin packages
- non-deterministic formatting rewrites of `opencode.jsonc`
- invasive changes to unrelated OpenCode configuration
- complex filtering UIs or exclude-rule DSLs

## Implementation Notes

The code should be written to keep the sync engine portable and testable:

- isolate filesystem access behind small helpers where useful
- isolate fetch/HTTP access behind the CLIProxy client
- keep patch planning separate from patch writing when practical
- make default selection and normalization pure utilities

## Write-Loop Protection

Watch mode must include concrete write-loop protection.

The preferred mechanism is:

1. compute a content hash before writing
2. record the last content hash written by this process
3. on subsequent watcher events, suppress sync re-entry when the current file content hash matches the last self-written hash within a short suppression window

If implementation details make pure content hashing insufficient, a small write suppression window may be combined with the hash check. Change-origin tracking is acceptable as an additional safety layer, but duplicated resync loops must be prevented explicitly.

This will make it easier to keep the plugin small while still supporting reliable tests.

## Open Questions Resolved by This Design

- **Plugin-first vs CLI-first:** plugin-first
- **Managed scope:** `ccs-*` only
- **Multiple providers:** supported
- **Retry behavior:** indefinite for transient CLIProxy failures
- **Default model behavior:** prefer discovered `ANTHROPIC_MODEL`, else first sorted
- **JSON editing approach:** `jsonc-parser` patch edits, not full rewrite
- **Thin CLI wrapper:** omit unless required for correct functioning

## Implementation Readiness

This design is ready to be turned into a concrete implementation plan.

The next step is to break the work into an executable plan that covers:

- dependency additions if needed
- module-by-module implementation order
- test-first or test-alongside checkpoints
- watch-mode decision gate
- verification commands
