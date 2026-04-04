import { describe, expect, it, vi } from 'vitest';
import { runSync } from '../../src/sync/service.ts';

describe('runSync', () => {
  it('returns a dry-run result without writing files', async () => {
    const writeFile = vi.fn();

    const result = await runSync({
      dryRun: true,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return 'cliproxy:\n  providers:\n    - claude';
        }

        return '{"provider":{},"model":""}';
      },
      writeFile,
      fetchModels: async () => ['claude-sonnet-4'],
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
    expect(result.defaultModel).toBe('ccs-claude/claude-sonnet-4');
    expect(result.mode).toBe('sync');
  });

  it('automatically resolves the project opencode.json by convention', async () => {
    const result = await runSync({
      dryRun: true,
      cwd: '/workspace',
      homeDir: '/home/test',
      pathExists: (candidate: string) => candidate === '/workspace/opencode.json',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return 'cliproxy:\n  providers:\n    - claude';
        }

        if (filePath === '/workspace/opencode.json') {
          return '{"provider":{},"model":""}';
        }

        throw new Error(`unexpected path: ${filePath}`);
      },
      writeFile: vi.fn(),
      fetchModels: async () => ['claude-sonnet-4'],
    });

    expect(result.resolvedPaths.opencodeConfigPath).toBe('/workspace/opencode.json');
  });

  it('chooses the lexicographically first managed provider as the global default', async () => {
    const writeFile = vi.fn();

    const result = await runSync({
      dryRun: false,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return 'cliproxy:\n  providers:\n    - codex\n    - claude\n';
        }

        return '{"provider":{},"model":""}';
      },
      writeFile,
      fetchModels: async ({ provider }: { provider: string }) =>
        provider === 'claude' ? ['claude-sonnet-4'] : ['gpt-5-codex', 'o3'],
    });

    expect(result.ok).toBe(true);
    expect(result.defaultModel).toBe('ccs-claude/claude-sonnet-4');
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('prefers the provider-specific ANTHROPIC_MODEL from live settings files for the default provider', async () => {
    const result = await runSync({
      dryRun: true,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return ['cliproxy:', '  providers:', '    - claude'].join('\n');
        }

        if (filePath.endsWith('claude.settings.json')) {
          return JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/claude',
              ANTHROPIC_MODEL: 'claude-opus-4',
              ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4',
            },
          });
        }

        return '{"provider":{},"model":""}';
      },
      readDir: async () => ['claude.settings.json'],
      writeFile: vi.fn(),
      fetchModels: async () => ['claude-sonnet-4', 'claude-opus-4'],
    });

    expect(result.defaultModel).toBe('ccs-claude/claude-opus-4');
  });

  it('reports no change when the generated config is already current', async () => {
    const currentConfig = [
      '{',
      '  "provider": {',
      '    "ccs-claude": {',
      '      "npm": "@ai-sdk/openai-compatible",',
      '      "name": "CCS Claude",',
      '      "options": {',
      '        "baseURL": "http://127.0.0.1:3456/api/provider/claude/v1",',
      '        "apiKey": "ccs-internal-managed"',
      '      },',
      '      "models": {',
      '        "claude-sonnet-4": {',
      '          "name": "Claude Sonnet 4"',
      '        }',
      '      }',
      '    }',
      '  },',
      '  "model": "ccs-claude/claude-sonnet-4"',
      '}',
    ].join('\n');

    const writeFile = vi.fn();
    const result = await runSync({
      dryRun: false,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) =>
        filePath.endsWith('config.yaml')
          ? 'cliproxy:\n  providers:\n    - claude\n'
          : currentConfig,
      writeFile,
      fetchModels: async () => ['claude-sonnet-4'],
    });

    expect(result.changed).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('passes the derived local cliproxy runtime into model discovery when no provider-specific URL exists', async () => {
    const fetchModels = vi.fn(async () => ['claude-sonnet-4']);

    await runSync({
      dryRun: true,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return [
            'env:',
            '  CLI_PROXY_BASE_URL: http://127.0.0.1:9999',
            'cliproxy:',
            '  providers:',
            '    - claude',
            'cliproxy_server:',
            '  local:',
            '    port: 8317',
          ].join('\n');
        }

        return '{"provider":{},"model":""}';
      },
      writeFile: vi.fn(),
      fetchModels,
    });

    expect(fetchModels).toHaveBeenCalledWith({
      provider: 'claude',
      runtimeBaseUrl: 'http://127.0.0.1:8317',
      bearerToken: 'ccs-internal-managed',
      includeModelFamilies: undefined,
      abortSignal: undefined,
    });
  });

  it('writes discovered models inside each managed provider instead of a root models block', async () => {
    const writes: string[] = [];

    await runSync({
      dryRun: false,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) =>
        filePath.endsWith('config.yaml')
          ? 'cliproxy:\n  providers:\n    - claude\n'
          : '{"provider":{},"model":""}',
      writeFile: async (_filePath: string, content: string) => {
        writes.push(content);
      },
      fetchModels: async () => ['claude-sonnet-4'],
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"ccs-claude"');
    expect(writes[0]).toContain('"models": {');
    expect(writes[0]).toContain('"claude-sonnet-4"');
    expect(writes[0]).not.toContain('"ccs-claude/claude-sonnet-4": {');
  });

  it('prefers actually configured settings-file providers over the broad cliproxy provider pool', async () => {
    const fetchModels = vi.fn(async () => ['model-1']);

    const result = await runSync({
      dryRun: true,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return [
            'cliproxy:',
            '  providers:',
            '    - gemini',
            '    - codex',
            '    - agy',
            'cliproxy_server:',
            '  local:',
            '    port: 8317',
          ].join('\n');
        }

        if (filePath.endsWith('codex.settings.json')) {
          return JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/codex',
              ANTHROPIC_MODEL: 'gpt-5.3-codex',
            },
          });
        }

        if (filePath.endsWith('agy.settings.json')) {
          return JSON.stringify({
            hooks: {
              PreToolUse: [],
            },
          });
        }

        return '{"provider":{},"model":""}';
      },
      readDir: async () => ['codex.settings.json', 'agy.settings.json'],
      writeFile: vi.fn(),
      fetchModels,
    });

    expect(result.providers).toEqual(['ccs-codex']);
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expect(fetchModels).toHaveBeenCalledWith({
      provider: 'codex',
      runtimeBaseUrl: 'http://127.0.0.1:8317',
      bearerToken: 'ccs-internal-managed',
      includeModelFamilies: undefined,
      abortSignal: undefined,
    });
  });

  it('limits each provider to the explicit selected models from live CCS settings files', async () => {
    const writes: string[] = [];

    await runSync({
      dryRun: false,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return [
            'cliproxy:',
            '  providers:',
            '    - codex',
            '    - claude',
            '    - ghcp',
            'cliproxy_server:',
            '  local:',
            '    port: 8317',
          ].join('\n');
        }

        if (filePath.endsWith('codex.settings.json')) {
          return JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/codex',
              ANTHROPIC_MODEL: 'gpt-5.3-codex',
              ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.3-codex',
              ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.3-codex',
              ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5-codex-mini',
            },
          });
        }

        if (filePath.endsWith('claude.settings.json')) {
          return JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/claude',
              ANTHROPIC_MODEL: 'claude-sonnet-4-6',
              ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-6',
              ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
              ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
            },
          });
        }

        if (filePath.endsWith('ghcp.settings.json')) {
          return JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/ghcp',
              ANTHROPIC_MODEL: 'claude-sonnet-4.5',
              ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4.5',
              ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4.5',
              ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4.5',
            },
          });
        }

        return '{"provider":{},"model":""}';
      },
      readDir: async () => ['codex.settings.json', 'claude.settings.json', 'ghcp.settings.json'],
      writeFile: async (_filePath: string, content: string) => {
        writes.push(content);
      },
      fetchModels: async ({ provider }: { provider: string }) =>
        provider === 'codex'
          ? ['gpt-5.3-codex', 'gpt-5-codex-mini', 'gpt-4o', 'claude-sonnet-4-6']
          : provider === 'ghcp'
            ? ['claude-sonnet-4.5', 'claude-opus-4.5', 'claude-haiku-4.5', 'gpt-5.3-codex']
            : [
                'claude-sonnet-4-6',
                'claude-opus-4-6',
                'claude-haiku-4-5-20251001',
                'gpt-5.3-codex',
              ],
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"ccs-codex"');
    expect(writes[0]).toContain('"gpt-5.3-codex"');
    expect(writes[0]).toContain('"gpt-5-codex-mini"');
    expect(writes[0]).toContain('"name": "GPT 5.3 Codex"');
    expect(writes[0]).toContain('"name": "GPT 5 Codex Mini"');
    expect(writes[0]).not.toContain('"gpt-4o"');
    expect(writes[0]).toContain('"ccs-claude"');
    expect(writes[0]).toContain('"claude-sonnet-4-6"');
    expect(writes[0]).toContain('"claude-opus-4-6"');
    expect(writes[0]).toContain('"claude-haiku-4-5-20251001"');
    expect(writes[0]).toContain('"name": "Claude Sonnet 4.6"');
    expect(writes[0]).toContain('"name": "Claude Opus 4.6"');
    expect(writes[0]).toContain('"name": "Claude Haiku 4.5 20251001"');
    expect(writes[0]).not.toContain('"claude-haiku-4-5"');
    expect(writes[0]).toContain('"ccs-ghcp"');
    expect(writes[0]).toContain('"name": "CCS GitHub Copilot"');
    expect(writes[0]).toContain('"name": "Claude Sonnet 4.5"');
    expect(writes[0]).toContain('"name": "Claude Opus 4.5"');
    expect(writes[0]).toContain('"name": "Claude Haiku 4.5"');
  });

  it('derives provider runtime URLs and preferred default models from live settings files', async () => {
    const fetchModels = vi.fn(async ({ provider }: { provider: string }) =>
      provider === 'codex'
        ? ['gpt-5-codex-mini', 'gpt-5.3-codex']
        : ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6']
    );

    const result = await runSync({
      dryRun: true,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return [
            'env:',
            '  CLI_PROXY_BASE_URL: http://127.0.0.1:9999',
            'cliproxy_server:',
            '  local:',
            '    port: 8317',
            'cliproxy:',
            '  providers:',
            '    - codex',
            '    - claude',
          ].join('\n');
        }

        if (filePath.endsWith('codex.settings.json')) {
          return JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/codex',
              ANTHROPIC_MODEL: 'gpt-5.3-codex',
              ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5-codex-mini',
            },
          });
        }

        if (filePath.endsWith('claude.settings.json')) {
          return JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/claude',
              ANTHROPIC_MODEL: 'claude-sonnet-4-6',
              ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
            },
          });
        }

        return '{"provider":{},"model":""}';
      },
      readDir: async () => ['codex.settings.json', 'claude.settings.json'],
      writeFile: vi.fn(),
      fetchModels,
    });

    expect(fetchModels).toHaveBeenNthCalledWith(1, {
      provider: 'claude',
      runtimeBaseUrl: 'http://127.0.0.1:8317',
      bearerToken: 'ccs-internal-managed',
      includeModelFamilies: undefined,
      abortSignal: undefined,
    });
    expect(fetchModels).toHaveBeenNthCalledWith(2, {
      provider: 'codex',
      runtimeBaseUrl: 'http://127.0.0.1:8317',
      bearerToken: 'ccs-internal-managed',
      includeModelFamilies: undefined,
      abortSignal: undefined,
    });
    expect(result.defaultModel).toBe('ccs-claude/claude-sonnet-4-6');
  });

  it('uses explicit human display names for provider labels', async () => {
    const writes: string[] = [];

    await runSync({
      dryRun: false,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return [
            'cliproxy:',
            '  providers:',
            '    - agy',
            '    - iflow',
            'cliproxy_server:',
            '  local:',
            '    port: 8317',
          ].join('\n');
        }

        if (filePath.endsWith('agy.settings.json')) {
          return JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/agy',
              ANTHROPIC_MODEL: 'claude-sonnet-4.5',
            },
          });
        }

        if (filePath.endsWith('iflow.settings.json')) {
          return JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/iflow',
              ANTHROPIC_MODEL: 'claude-sonnet-4.5',
            },
          });
        }

        return '{"provider":{},"model":""}';
      },
      readDir: async () => ['agy.settings.json', 'iflow.settings.json'],
      writeFile: async (_filePath: string, content: string) => {
        writes.push(content);
      },
      fetchModels: async () => ['claude-sonnet-4.5'],
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"name": "CCS AGY"');
    expect(writes[0]).toContain('"name": "CCS iFlow"');
  });
});
