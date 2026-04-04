# opencode-ccs-sync

`opencode-ccs-sync` is an OpenCode plugin that reads your CCS configuration, inspects the
live CCS provider settings files in `~/.ccs`, validates the resulting model choices against
CLIProxy, and writes those managed `ccs-*` providers into your OpenCode config.

It is designed to be safe and repeatable:

- it only manages `ccs-*` providers and their provider-local model lists
- it preserves unrelated OpenCode config and JSONC comments
- it chooses one deterministic global default model for OpenCode
- it supports dry runs and long-running watch mode
- it returns structured JSON so it is safe to call from OpenCode agents and automation

## What you need before this can work

You MUST have all of the following working first:

1. **OpenCode installed and running**
2. **CCS installed and configured**
3. **CLIProxy reachable from your machine**
4. **A CCS config file at `~/.ccs/config.yaml`**, or a plan to pass `ccsConfigPath`

If CCS itself is not healthy, this plugin cannot fix that for you. It only syncs CCS state
into OpenCode.

## Quick checklist

Before you add this plugin, you SHOULD verify:

- `ccs doctor` succeeds or at least clearly reports the current CCS state
- your CLIProxy base URL is correct
- your CCS `providers` list contains the providers you expect to sync
- OpenCode is already using a config file you can edit

If you are unsure whether CCS is configured correctly, start here:

```bash
ccs doctor
```

That is the fastest way to catch broken CCS setup before debugging this plugin.

## What the plugin actually does

When you call the `ccs_sync` tool, it does this in order:

1. Resolves the OpenCode config path
2. Resolves the CCS config path
3. Parses and normalizes CCS config values
4. Inspects live `~/.ccs/*.settings.json` files to determine which providers are actually in use
5. Extracts the explicit selected/default models for each live provider from Anthropic-compatible env values
6. Validates those model choices against CLIProxy discovery for each provider
7. Rewrites only the managed `ccs-*` sections in your OpenCode config
8. Chooses one global OpenCode `model` value deterministically
9. Returns a structured JSON result describing what changed

The plugin does **not** prompt interactively. All input comes from JSON tool arguments.

## Managed scope

This plugin only owns entries prefixed with `ccs-`.

It may create, update, or remove:

- `provider.ccs-*`
- `provider.ccs-*.models`
- the global `model` field when a CCS default model is selected

It does **not** touch unrelated entries like `openai`, `anthropic`, or any non-`ccs-*`
providers.

## Install in OpenCode

OpenCode supports loading plugins either from a package name in config or from local files.

Official docs:

- OpenCode config: <https://opencode.ai/docs/config/>
- OpenCode plugins: <https://opencode.ai/docs/plugins/>

### Option A: install by package name

Add this package to the `plugin` array in your OpenCode config.

Example:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-ccs-sync"],
}
```

OpenCode resolves and installs package-based plugins automatically with Bun at startup.

### Option B: test locally from a plugin file

If you are developing or testing this repo locally, OpenCode can also load plugins from:

- `.opencode/plugins/` in your project
- `~/.config/opencode/plugins/` globally

For a local test, you can place a built plugin file in one of those directories and let
OpenCode load it directly.

## Where to put the OpenCode config

OpenCode’s docs describe config files such as:

- global: `~/.config/opencode/opencode.json`
- project: `./opencode.json`

### Important implementation detail for this plugin

This plugin currently looks for **`opencode.jsonc` by default**, in this order:

1. explicit `opencodeConfigPath`
2. `./opencode.jsonc`
3. `~/.config/opencode/opencode.jsonc`

So if your real OpenCode config is stored as `opencode.json`, you SHOULD pass
`opencodeConfigPath` explicitly when you call `ccs_sync`.

That avoids guessing and matches the current implementation exactly.

## Where to put the CCS config

By default, the plugin reads:

```text
~/.ccs/config.yaml
```

If your CCS config lives elsewhere, pass `ccsConfigPath` explicitly.

CCS reference:

- CCS repository/README: <https://github.com/kaitranntt/ccs>

## CCS inputs this plugin actually uses

The plugin reads two kinds of CCS inputs:

1. `~/.ccs/config.yaml` for high-level runtime details such as:

- `env.CLI_PROXY_BASE_URL`
- `env.ANTHROPIC_MODEL`
- `providers`
- `defaultProvider`
- `cliproxy.providers`
- `cliproxy_server.local.port`

2. Live `~/.ccs/*.settings.json` files for the real provider/model selections that SHOULD be
   exposed in OpenCode.

Those settings files are the main source of truth for narrowing what gets registered.

Example:

```yaml
env:
  CLI_PROXY_BASE_URL: http://127.0.0.1:3456
  ANTHROPIC_MODEL: claude-sonnet-4
providers:
  - claude
  - codex
defaultProvider: claude
```

If `CLI_PROXY_BASE_URL` is missing, the plugin can derive the runtime URL from
`cliproxy_server.local.port`. If neither value exists, it defaults to:

```text
http://127.0.0.1:3456
```

The plugin always uses this bearer token when talking to CLIProxy:

```text
ccs-internal-managed
```

## How provider selection really works

The plugin does **not** register every provider listed in the broad CCS cliproxy pool.

Instead, it prefers live provider settings files in `~/.ccs/`, such as:

- `codex.settings.json`
- `claude.settings.json`
- `ghcp.settings.json`

A provider is treated as actually configured only when its live settings file contains an
Anthropic-compatible env marker such as:

- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`

Files that do not expose those env values are ignored for OpenCode registration. That means a
file like `agy.settings.json` with hooks only will not create `ccs-agy` in OpenCode.

If no live settings files can be used, the plugin falls back to the broader provider list from
`config.yaml`.

## How model selection really works

For each kept provider, the plugin does **not** expose the full discovery universe from CLIProxy.

Instead, it builds a per-provider allowlist from the live provider settings file using these env
keys:

- `ANTHROPIC_MODEL`
- `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`

That explicit model set is then validated against the provider’s discovered CLIProxy models.

So the final provider-local model list is:

1. models explicitly selected in the provider’s live CCS settings file
2. filtered to those that actually exist in discovery

This is why the plugin no longer writes giant mixed model lists under every `ccs-*` provider.

### Example

If `codex.settings.json` contains:

```json
{
  "env": {
    "ANTHROPIC_MODEL": "gpt-5.3-codex",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "gpt-5.3-codex",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-5.3-codex",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-5-codex-mini"
  }
}
```

then `ccs-codex.models` SHOULD end up containing only:

- `gpt-5.3-codex`
- `gpt-5-codex-mini`

not unrelated models such as `gpt-4o`, Gemini models, or Claude models.

## The OpenCode tool this plugin adds

The plugin registers exactly one custom tool:

```text
ccs_sync
```

It accepts these optional JSON arguments:

```json
{
  "opencodeConfigPath": "/absolute/or/relative/path/to/opencode.jsonc",
  "ccsConfigPath": "/absolute/or/relative/path/to/config.yaml",
  "providers": ["claude", "codex"],
  "includeModelFamilies": ["claude", "gpt"],
  "dryRun": true,
  "watch": false
}
```

### Argument behavior

- `opencodeConfigPath`: override the default OpenCode config lookup
- `ccsConfigPath`: override the default CCS config lookup
- `providers`: sync only a specific provider subset
- `includeModelFamilies`: keep only model IDs matching the given prefixes
- `dryRun`: compute the result but do not write the OpenCode config
- `watch`: stay running and resync on config changes

### Example OpenCode usage

Once the plugin is loaded, the safest first call is a dry run.

Example prompt inside OpenCode:

```text
Run ccs_sync with {"dryRun": true}
```

If your OpenCode config is actually stored as `opencode.json`, make the path explicit:

```text
Run ccs_sync with {"dryRun": true, "opencodeConfigPath": "./opencode.json"}
```

If the returned JSON looks correct, run the real sync:

```text
Run ccs_sync with {}
```

## How default model selection works

OpenCode has one global `model` field. This plugin always writes at most one default model.

When multiple CCS providers are available, it chooses deterministically:

1. sort provider IDs lexicographically
2. pick the first provider
3. inside that provider, prefer `ANTHROPIC_MODEL` if it exists in the final validated provider model list
4. otherwise pick the first lexicographically sorted model ID

The final written format is always:

```text
ccs-<provider>/<model-id>
```

## What gets written into OpenCode

Managed providers are written as OpenCode custom providers using
`@ai-sdk/openai-compatible`.

Example generated shape:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-ccs-sync"],
  "provider": {
    "ccs-claude": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CCS Claude",
      "options": {
        "baseURL": "http://127.0.0.1:3456/api/provider/claude/v1",
        "apiKey": "ccs-internal-managed",
      },
      "models": {
        "claude-sonnet-4-6": {
          "name": "Claude Sonnet 4 6",
        },
        "claude-opus-4-6": {
          "name": "Claude Opus 4 6",
        },
        "claude-haiku-4-5-20251001": {
          "name": "Claude Haiku 4 5 20251001",
        },
      },
    },
  },
  "model": "ccs-claude/claude-sonnet-4-6",
}
```

Important: there is **no** root-level `models` block. OpenCode expects provider-local `models`.

## JSON result returned by `ccs_sync`

The tool returns JSON as a string so OpenCode automation can parse it safely.

Example:

```json
{
  "ok": true,
  "mode": "sync",
  "changed": true,
  "resolvedPaths": {
    "opencodeConfigPath": "/workspace/opencode.jsonc",
    "ccsConfigPath": "/home/user/.ccs/config.yaml"
  },
  "providers": ["ccs-claude"],
  "defaultModel": "ccs-claude/claude-sonnet-4",
  "summary": "Updated 1 CCS provider(s). Default model: ccs-claude/claude-sonnet-4."
}
```

## Retry behavior

Model discovery retries indefinitely only for transient availability failures such as:

- connection failures
- CLIProxy being unavailable
- retryable 5xx responses

It does **not** retry indefinitely for:

- malformed local config
- invalid YAML
- non-retryable 4xx HTTP responses from model discovery

Backoff starts at 1 second and is capped at 30 seconds.

## Watch mode

If you call the tool with `watch: true`, it:

- runs one initial sync
- watches the resolved CCS config path
- watches the resolved OpenCode config path
- re-runs sync when either file changes
- suppresses self-triggered write loops using content hashing and a short suppression window

Watch mode is useful if you expect CCS config or managed model availability to change while
OpenCode is already running.

## Fastest way to test this as a user

If you want the quickest end-to-end validation, follow this order:

1. make sure CCS works
2. run `ccs doctor`
3. confirm `~/.ccs/config.yaml` has the providers you expect
4. add the plugin to OpenCode
5. call `ccs_sync` with `dryRun: true`
6. inspect the returned `resolvedPaths`, `providers`, and `defaultModel`
7. confirm each generated `provider.ccs-*` contains only the models explicitly selected in the matching live `~/.ccs/*.settings.json` file
8. call it again without `dryRun` to write the config

That gives you one safe preview run before touching your OpenCode config.

## Local testing for this repository

### Verify the repo itself

Use these commands from the repository root:

```bash
bun install
bun test
./node_modules/.bin/eslint .
bunx tsc --noEmit
bun build ./src/index.ts --outdir dist --target bun
```

### Test the plugin locally in OpenCode

You have two practical options.

#### Option 1: use the package name through OpenCode config

This is the normal user path once the package is published and available to Bun:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-ccs-sync"],
}
```

#### Option 2: load a local plugin file during development

OpenCode can load local JavaScript/TypeScript plugin files from:

- `.opencode/plugins/`
- `~/.config/opencode/plugins/`

For local development, you SHOULD build this repo first:

```bash
bun build ./src/index.ts --outdir dist --target bun
```

Then copy or symlink the built plugin file into one of OpenCode’s plugin directories.

Example project-local setup:

```bash
mkdir -p .opencode/plugins
ln -sf "$(pwd)/dist/index.js" .opencode/plugins/opencode-ccs-sync.js
```

Example global setup:

```bash
mkdir -p ~/.config/opencode/plugins
ln -sf "$(pwd)/dist/index.js" ~/.config/opencode/plugins/opencode-ccs-sync.js
```

After restarting OpenCode, test with:

```text
Run ccs_sync with {"dryRun": true}
```

If your config is stored as `opencode.json`, use:

```text
Run ccs_sync with {"dryRun": true, "opencodeConfigPath": "./opencode.json"}
```

## Troubleshooting tips

If sync does not behave as expected, check these in order:

1. `ccs doctor`
2. verify `~/.ccs/config.yaml` exists and CLIProxy is pointed at the expected local server
3. verify the live `~/.ccs/*.settings.json` files contain the providers and Anthropic model envs you actually expect OpenCode to expose
4. verify CLIProxy is reachable at `CLI_PROXY_BASE_URL` or the derived local cliproxy port
5. run `ccs_sync` with `dryRun: true`
6. inspect `resolvedPaths` in the JSON result
7. if your OpenCode config is actually `opencode.json`, pass `opencodeConfigPath` explicitly

Common causes of confusion:

- using `opencode.json` while this plugin is defaulting to `opencode.jsonc`
- CCS is installed but not healthy yet
- providers appear in `cliproxy.providers` but do not have live Anthropic-compatible `*.settings.json` files
- CLIProxy is reachable but a discovered model is not explicitly selected in the live provider settings, so it is intentionally omitted
- expecting non-`ccs-*` providers/models to be modified

## Development coverage

Unit tests currently cover:

- cross-platform path resolution
- CCS config parsing and normalization
- model extraction, retry classification, and network discovery
- narrowing providers from live `~/.ccs/*.settings.json`
- narrowing provider-local models from `ANTHROPIC_MODEL` and `ANTHROPIC_DEFAULT_*`
- JSONC patching with comment preservation
- `ccs-*` ownership boundaries
- deterministic default model selection
- dry-run behavior and idempotency
- plugin tool registration and JSON output
- watch-mode write-loop suppression

## License

See [LICENSE](LICENSE).
