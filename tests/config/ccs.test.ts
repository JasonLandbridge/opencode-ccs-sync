import { describe, expect, it } from 'vitest';
import {
  inferProviderMetadataFromSettingsFiles,
  inferProviderSelectionsFromSettingsFiles,
  inferProvidersFromSettingsFiles,
  normalizeCcsConfig,
  parseCcsConfig,
} from '../../src/config/ccs.ts';

describe('CCS config normalization', () => {
  it('derives runtime/providers from conventional cliproxy fields instead of broad YAML env overrides', () => {
    const parsed = parseCcsConfig(`
env:
  CLI_PROXY_BASE_URL: http://localhost:3456
  ANTHROPIC_MODEL: claude-sonnet-4
cliproxy:
  providers:
    - claude
    - codex
cliproxy_server:
  local:
    port: 8317
`);

    expect(normalizeCcsConfig(parsed)).toMatchObject({
      runtimeBaseUrl: 'http://127.0.0.1:8317',
      selectedProviders: ['claude', 'codex'],
      bearerToken: 'ccs-internal-managed',
    });
  });

  it('deduplicates and sorts providers lexicographically', () => {
    const parsed = parseCcsConfig(`
cliproxy:
  providers:
    - codex
    - claude
    - codex
    - "  claude  "
`);

    expect(normalizeCcsConfig(parsed).selectedProviders).toEqual(['claude', 'codex']);
  });

  it('falls back to localhost runtime defaults when env is absent', () => {
    const parsed = parseCcsConfig('cliproxy:\n  providers:\n    - claude\n');

    expect(normalizeCcsConfig(parsed)).toMatchObject({
      runtimeBaseUrl: 'http://127.0.0.1:3456',
      bearerToken: 'ccs-internal-managed',
      selectedProviders: ['claude'],
    });
  });

  it('supports the real cliproxy provider list and local port structure from config.yaml', () => {
    const parsed = parseCcsConfig(`
cliproxy:
  providers:
    - gemini
    - codex
    - agy
cliproxy_server:
  local:
    port: 8317
`);

    expect(normalizeCcsConfig(parsed)).toMatchObject({
      runtimeBaseUrl: 'http://127.0.0.1:8317',
      selectedProviders: ['agy', 'codex', 'gemini'],
      bearerToken: 'ccs-internal-managed',
    });
  });

  it('uses the derived local cliproxy port instead of broad YAML env overrides', () => {
    const parsed = parseCcsConfig(`
env:
  CLI_PROXY_BASE_URL: http://127.0.0.1:9999
cliproxy:
  providers:
    - codex
cliproxy_server:
  local:
    port: 8317
`);

    expect(normalizeCcsConfig(parsed)).toMatchObject({
      runtimeBaseUrl: 'http://127.0.0.1:8317',
      selectedProviders: ['codex'],
    });
  });

  it('infers actually configured providers from Anthropic-compatible settings files', () => {
    expect(
      inferProvidersFromSettingsFiles({
        'codex.settings.json': JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/codex',
            ANTHROPIC_MODEL: 'gpt-5.3-codex',
          },
        }),
        'agy.settings.json': JSON.stringify({
          hooks: {
            PreToolUse: [],
          },
        }),
        'claude.settings.json': JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/claude',
          },
        }),
      })
    ).toEqual(['claude', 'codex']);
  });

  it('infers only explicitly selected models from live provider settings files', () => {
    expect(
      inferProviderSelectionsFromSettingsFiles({
        'codex.settings.json': JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/codex',
            ANTHROPIC_MODEL: 'gpt-5.3-codex',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.3-codex',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.3-codex',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5-codex-mini',
          },
        }),
        'claude.settings.json': JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/claude',
            ANTHROPIC_MODEL: 'claude-sonnet-4-6',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-6',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
          },
        }),
        'agy.settings.json': JSON.stringify({
          hooks: {
            PreToolUse: [],
          },
        }),
      })
    ).toEqual({
      claude: ['claude-haiku-4-5-20251001', 'claude-opus-4-6', 'claude-sonnet-4-6'],
      codex: ['gpt-5-codex-mini', 'gpt-5.3-codex'],
    });
  });

  it('derives provider base URLs and selected models from live settings files', () => {
    expect(
      inferProviderMetadataFromSettingsFiles({
        'codex.settings.json': JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/codex',
            ANTHROPIC_MODEL: 'gpt-5.3-codex',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5-codex-mini',
          },
        }),
        'claude.settings.json': JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/claude',
            ANTHROPIC_MODEL: 'claude-sonnet-4-6',
          },
        }),
      })
    ).toEqual({
      claude: {
        providerBaseUrl: 'http://127.0.0.1:8317/api/provider/claude',
        preferredModel: 'claude-sonnet-4-6',
        selectedModels: ['claude-sonnet-4-6'],
      },
      codex: {
        providerBaseUrl: 'http://127.0.0.1:8317/api/provider/codex',
        preferredModel: 'gpt-5.3-codex',
        selectedModels: ['gpt-5-codex-mini', 'gpt-5.3-codex'],
      },
    });
  });
});
