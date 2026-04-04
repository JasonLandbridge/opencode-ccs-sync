# opencode-ccs-sync

`opencode-ccs-sync` is an OpenCode plugin that reads your [Claude Code Switch](https://github.com/kaitranntt/ccs) (CCS) configuration and automatically keeps your OpenCode config in sync.

It is designed to be safe and repeatable:

- it only manages `ccs-*` providers and their provider-local model lists
- it preserves unrelated OpenCode config and JSONC comments
- it chooses one deterministic global default model for OpenCode
- it automatically syncs once on every OpenCode startup
- it automatically re-syncs when the CCS config changes while OpenCode is running
- it exposes structured JSON through its internal tool surface for automation and debugging

## What you need before this can work

You MUST have all of the following working first:

1. **[OpenCode installed and running](https://opencode.ai/)** 
2. **[CCS installed and configured](https://docs.ccs.kaitran.ca)**
3. **[CLIProxy reachable from your machine](https://help.router-for.me/)**
4. **A CCS config file at `~/.ccs/config.yaml`, see CCS Install** 

If CCS itself is not healthy, this plugin cannot fix that for you. It only syncs CCS state
into OpenCode.

## Quick checklist

Before you add this plugin, you SHOULD verify:

- `ccs doctor` succeeds or at least clearly reports the current CCS state
- your live `~/.ccs/*.settings.json` files exist for the providers you actually use
- those live settings files contain the Anthropic-compatible values you expect
- OpenCode is already using a config file you can edit

If you are unsure whether CCS is configured correctly, start here:

```bash
ccs doctor
```

That is the fastest way to catch broken CCS setup before debugging this plugin.

## What the plugin actually does

Once OpenCode loads the plugin, it starts a background sync/watch process automatically.

That startup process does this:

1. resolves your OpenCode config path
2. resolves your CCS config path
3. parses and normalizes CCS config values
4. inspects live `~/.ccs/*.settings.json` files to determine which providers are actually in use
5. extracts the explicit selected/default models for each live provider from Anthropic-compatible env values
6. validates those selected models against CLIProxy discovery
7. rewrites only the managed `ccs-*` sections in your OpenCode config
8. chooses one deterministic global default model for OpenCode
9. keeps watching for CCS/OpenCode config changes and repeats the sync when needed

The normal user flow is therefore:

1. install or link the plugin
2. restart OpenCode
3. let the plugin perform its automatic startup sync
4. edit CCS config as needed and let the plugin re-sync automatically


## Managed scope

This plugin only owns entries prefixed with `ccs-`.

It may create, update, or remove:

- `provider.ccs-*`
- `provider.ccs-*.models`
- the global `model` field when a CCS default model is selected

It does **not** touch unrelated entries like `openai`, `anthropic`, or any non-`ccs-*`
providers.

## Install in OpenCode

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

This plugin follows OpenCode's normal file conventions automatically.

It resolves your OpenCode config in this order:

1. `./opencode.json`
2. `./opencode.jsonc`
3. `~/.config/opencode/opencode.json`
4. `~/.config/opencode/opencode.jsonc`

## Where to put the CCS config

By default, the plugin reads:

```text
~/.ccs/config.yaml
```

CCS reference:

- CCS repository/README: <https://github.com/kaitranntt/ccs>
- CCS docs: <https://docs.ccs.kaitran.ca>

## CCS inputs this plugin actually uses

The plugin reads two kinds of CCS inputs:

1. `~/.ccs/config.yaml` for broad CCS/CLIProxy context such as:

- `cliproxy.providers`
- `cliproxy_server.local.port`

2. Live `~/.ccs/*.settings.json` files for the provider-specific values that actually matter for
   OpenCode registration:

- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`

The live `*.settings.json` files are the more specific source of truth. This plugin uses them to
decide:

- which providers are actually active
- which models should be offered for each provider
- which runtime base URL a given provider really uses
- which model should be preferred as the default for that provider

If a provider-specific base URL cannot be derived from live settings, the plugin falls back to the
local cliproxy port from `config.yaml`. If neither value exists, it defaults to:

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

## Automatic sync lifecycle

After OpenCode loads the plugin, the plugin immediately starts its background watch flow.

That means:

- **on every OpenCode start**, it performs one initial sync
- **while OpenCode keeps running**, it watches the resolved CCS config path
- it also watches the resolved OpenCode config path
- if either file changes, it re-runs sync automatically
- it suppresses self-triggered write loops using content hashing and a short suppression window

This automatic lifecycle is the primary user-facing behavior. You SHOULD think of this as a
background syncing plugin, not a manual command you have to keep invoking.


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
          "name": "Claude Sonnet 4.6",
        },
        "claude-opus-4-6": {
          "name": "Claude Opus 4.6",
        },
        "claude-haiku-4-5-20251001": {
          "name": "Claude Haiku 4.5 20251001",
        },
      },
    },
  },
  "model": "ccs-claude/claude-sonnet-4-6",
}
```

Important: there is **no** root-level `models` block. OpenCode expects provider-local `models`.

## Logging and debugging

If you need to debug the plugin, use OpenCode's normal logs rather than manually driving sync as a
user workflow.

Useful checks:

- restart OpenCode and inspect the config after startup
- inspect OpenCode logs for `opencode-ccs-sync`
- confirm the generated `provider.ccs-*` entries match the live `~/.ccs/*.settings.json` files
- edit the CCS config and confirm OpenCode updates automatically while still running

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

## Fastest way to test this as a user

If you want the quickest end-to-end validation, follow this order:

1. make sure CCS works
2. run `ccs doctor`
3. confirm `~/.ccs/config.yaml` and the live `~/.ccs/*.settings.json` files contain the providers/models you actually expect
4. add the plugin to OpenCode
5. restart OpenCode
6. inspect your OpenCode config after startup sync
7. confirm each generated `provider.ccs-*` contains only the models explicitly selected in the matching live `~/.ccs/*.settings.json` file
8. edit the CCS config and confirm the plugin re-syncs automatically while OpenCode is still running

That is the real user path now: install, restart, verify auto-sync, then verify automatic re-sync on CCS changes.

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

After restarting OpenCode, the plugin SHOULD perform its initial sync automatically.

For local validation, check these instead of manually invoking the internal tool:

1. OpenCode starts without plugin load errors
2. your OpenCode config is updated on startup
3. only `ccs-*` sections are changed
4. provider-local model lists match the live `~/.ccs/*.settings.json` selections
5. editing the CCS config triggers another automatic sync while OpenCode is still open

## Troubleshooting tips

If sync does not behave as expected, check these in order:

1. `ccs doctor`
2. verify `~/.ccs/config.yaml` exists and CLIProxy is pointed at the expected local server
3. verify the live `~/.ccs/*.settings.json` files contain the providers and Anthropic model envs you actually expect OpenCode to expose
4. verify CLIProxy is reachable at the provider-specific `ANTHROPIC_BASE_URL` values from the live settings files, or at the derived local cliproxy port if those are absent
5. restart OpenCode and inspect the OpenCode log output / config result after startup

Common causes of confusion:

- CCS is installed but not healthy yet
- providers appear in `cliproxy.providers` but do not have live Anthropic-compatible `*.settings.json` files
- CLIProxy is reachable but a discovered model is not explicitly selected in the live provider settings, so it is intentionally omitted
- expecting non-`ccs-*` providers/models to be modified

## License

See [LICENSE](LICENSE).
