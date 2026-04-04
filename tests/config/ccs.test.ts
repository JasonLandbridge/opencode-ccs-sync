import { describe, expect, it } from 'vitest';
import { normalizeCcsConfig, parseCcsConfig } from '../../src/config/ccs.ts';

describe('CCS config normalization', () => {
  it('normalizes runtime URL, providers, and ANTHROPIC_MODEL', () => {
    const parsed = parseCcsConfig(`
env:
  CLI_PROXY_BASE_URL: http://localhost:3456
  ANTHROPIC_MODEL: claude-sonnet-4
providers:
  - claude
  - codex
`);

    expect(normalizeCcsConfig(parsed)).toMatchObject({
      runtimeBaseUrl: 'http://localhost:3456',
      selectedProviders: ['claude', 'codex'],
      anthropicModel: 'claude-sonnet-4',
      bearerToken: 'ccs-internal-managed',
    });
  });

  it('deduplicates and sorts providers lexicographically', () => {
    const parsed = parseCcsConfig(`
env:
  CLI_PROXY_BASE_URL: http://localhost:3456
providers:
  - codex
  - claude
  - codex
  - "  claude  "
`);

    expect(normalizeCcsConfig(parsed).selectedProviders).toEqual(['claude', 'codex']);
  });

  it('falls back to localhost runtime defaults when env is absent', () => {
    const parsed = parseCcsConfig('providers:\n  - claude\n');

    expect(normalizeCcsConfig(parsed)).toMatchObject({
      runtimeBaseUrl: 'http://127.0.0.1:3456',
      bearerToken: 'ccs-internal-managed',
      selectedProviders: ['claude'],
    });
  });
});
