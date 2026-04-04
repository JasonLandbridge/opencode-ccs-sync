import { describe, expect, it, vi } from 'vitest';
import pluginModule, { createServer, server } from './index.ts';
import type { SyncResult } from './sync/service.ts';

function createSyncResult(input: SyncResult): SyncResult {
  return input;
}

describe('opencode-ccs-sync plugin', () => {
  it('exports a plugin module with the ccs_sync tool', async () => {
    const hooks = await server({
      client: {} as never,
      project: {} as never,
      directory: '/workspace',
      worktree: '/workspace',
      serverUrl: new URL('http://localhost:4096'),
      $: {} as never,
    });

    expect(pluginModule.server).toBe(server);
    expect(hooks.tool).toBeDefined();
    expect(hooks.tool?.ccs_sync).toBeDefined();
  });

  it('returns structured JSON from the ccs_sync tool', async () => {
    const customServer = createServer({
      runSync: vi.fn(async () =>
        createSyncResult({
          ok: true,
          mode: 'sync',
          changed: true,
          resolvedPaths: {
            opencodeConfigPath: '/workspace/opencode.jsonc',
            ccsConfigPath: '/workspace/config.yaml',
          },
          providers: ['ccs-claude'],
          defaultModel: 'ccs-claude/claude-sonnet-4',
          summary: 'Updated 1 CCS provider(s). Default model: ccs-claude/claude-sonnet-4.',
        })
      ),
      runWatchMode: vi.fn(async () =>
        createSyncResult({
          ok: true,
          mode: 'watch',
          changed: false,
          resolvedPaths: {
            opencodeConfigPath: '/workspace/opencode.jsonc',
            ccsConfigPath: '/workspace/config.yaml',
          },
          providers: ['ccs-claude'],
          defaultModel: 'ccs-claude/claude-sonnet-4',
          summary: 'Verified 1 CCS provider(s). Default model: ccs-claude/claude-sonnet-4.',
        })
      ),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      discoverProviderModels: vi.fn(),
      homeDir: '/home/test',
    });

    const hooks = await customServer({
      client: {} as never,
      project: {} as never,
      directory: '/workspace',
      worktree: '/workspace',
      serverUrl: new URL('http://localhost:4096'),
      $: {} as never,
    });
    const execute = hooks.tool?.ccs_sync.execute;

    expect(execute).toBeDefined();

    const output = await execute!(
      {
        dryRun: true,
        opencodeConfigPath: '/workspace/opencode.jsonc',
        ccsConfigPath: '/workspace/config.yaml',
      },
      {
        sessionID: 'session-1',
        messageID: 'message-1',
        agent: 'test-agent',
        directory: '/workspace',
        worktree: '/workspace',
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask: vi.fn(),
      }
    );

    const parsed = JSON.parse(output) as {
      ok: boolean;
      mode: string;
      providers: string[];
      resolvedPaths: { opencodeConfigPath: string; ccsConfigPath: string };
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.mode).toBe('sync');
    expect(parsed.providers).toEqual(['ccs-claude']);
    expect(parsed.resolvedPaths.opencodeConfigPath).toBe('/workspace/opencode.jsonc');
  });

  it('routes watch requests to the watch runtime helper', async () => {
    const runWatchMode = vi.fn(async () =>
      createSyncResult({
        ok: true,
        mode: 'watch',
        changed: false,
        resolvedPaths: {
          opencodeConfigPath: '/workspace/opencode.jsonc',
          ccsConfigPath: '/workspace/config.yaml',
        },
        providers: ['ccs-claude'],
        defaultModel: 'ccs-claude/claude-sonnet-4',
        summary: 'Verified 1 CCS provider(s). Default model: ccs-claude/claude-sonnet-4.',
      })
    );
    const customServer = createServer({
      runSync: vi.fn(),
      runWatchMode,
      readFile: vi.fn(),
      writeFile: vi.fn(),
      discoverProviderModels: vi.fn(),
      homeDir: '/home/test',
    });
    const hooks = await customServer({
      client: {} as never,
      project: {} as never,
      directory: '/workspace',
      worktree: '/workspace',
      serverUrl: new URL('http://localhost:4096'),
      $: {} as never,
    });

    const output = await hooks.tool?.ccs_sync.execute(
      { watch: true },
      {
        sessionID: 'session-1',
        messageID: 'message-1',
        agent: 'test-agent',
        directory: '/workspace',
        worktree: '/workspace',
        abort: new AbortController().signal,
        metadata: vi.fn(),
        ask: vi.fn(),
      }
    );

    expect(runWatchMode).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output ?? '{}').mode).toBe('watch');
  });
});
