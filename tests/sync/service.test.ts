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
          return 'providers:\n  - claude';
        }

        return '{"provider":{},"models":{},"model":""}';
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

  it('chooses the lexicographically first managed provider as the global default', async () => {
    const writeFile = vi.fn();

    const result = await runSync({
      dryRun: false,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return 'providers:\n  - codex\n  - claude\n';
        }

        return '{"provider":{},"models":{},"model":""}';
      },
      writeFile,
      fetchModels: async ({ provider }: { provider: string }) =>
        provider === 'claude' ? ['claude-sonnet-4'] : ['gpt-5-codex', 'o3'],
    });

    expect(result.ok).toBe(true);
    expect(result.defaultModel).toBe('ccs-claude/claude-sonnet-4');
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('prefers ANTHROPIC_MODEL when it exists for the default provider', async () => {
    const result = await runSync({
      dryRun: true,
      cwd: '/workspace',
      homeDir: '/home/test',
      readFile: async (filePath: string) => {
        if (filePath.endsWith('config.yaml')) {
          return ['env:', '  ANTHROPIC_MODEL: claude-opus-4', 'providers:', '  - claude'].join(
            '\n'
          );
        }

        return '{"provider":{},"models":{},"model":""}';
      },
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
      '      }',
      '    }',
      '  },',
      '  "models": {',
      '    "ccs-claude/claude-sonnet-4": {',
      '      "provider": "ccs-claude",',
      '      "id": "claude-sonnet-4"',
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
        filePath.endsWith('config.yaml') ? 'providers:\n  - claude\n' : currentConfig,
      writeFile,
      fetchModels: async () => ['claude-sonnet-4'],
    });

    expect(result.changed).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('passes normalized runtime settings into model discovery', async () => {
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
            'providers:',
            '  - claude',
          ].join('\n');
        }

        return '{"provider":{},"models":{},"model":""}';
      },
      writeFile: vi.fn(),
      fetchModels,
    });

    expect(fetchModels).toHaveBeenCalledWith({
      provider: 'claude',
      runtimeBaseUrl: 'http://127.0.0.1:9999',
      bearerToken: 'ccs-internal-managed',
      includeModelFamilies: undefined,
      abortSignal: undefined,
    });
  });
});
