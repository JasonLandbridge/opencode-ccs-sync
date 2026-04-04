import { describe, expect, it, vi } from 'vitest';
import pluginModule, { createServer, server } from '../src/index.ts';
import type { SyncResult } from '../src/sync/service.ts';

function createSyncResult(input: SyncResult): SyncResult {
  return input;
}

function createPluginInput(log: ReturnType<typeof vi.fn> = vi.fn()) {
  return {
    client: {
      app: {
        log,
      },
    } as never,
    project: {} as never,
    directory: '/workspace',
    worktree: '/workspace',
    serverUrl: new URL('http://localhost:4096'),
    $: {} as never,
  };
}

describe('opencode-ccs-sync plugin', () => {
  it('exports a plugin module with the ccs_sync tool', async () => {
    const hooks = await server(createPluginInput());

    expect(pluginModule.id).toBe('opencode-ccs-sync');
    expect(pluginModule.server).toBe(server);
    expect(hooks.tool).toBeDefined();
    expect(hooks.tool?.ccs_sync).toBeDefined();
  });

  it('runs an initial sync automatically when the plugin loads', async () => {
    const runWatchMode = vi.fn(async () =>
      createSyncResult({
        ok: true,
        mode: 'watch',
        changed: false,
        resolvedPaths: {
          opencodeConfigPath: '/workspace/opencode.json',
          ccsConfigPath: '/workspace/config.yaml',
        },
        providers: ['ccs-claude'],
        defaultModel: 'ccs-claude/claude-sonnet-4',
        summary: 'Verified 1 CCS provider(s). Default model: ccs-claude/claude-sonnet-4.',
      })
    );
    const customServer = createServer({
      runSync: vi.fn(async () =>
        createSyncResult({
          ok: true,
          mode: 'sync',
          changed: false,
          resolvedPaths: {
            opencodeConfigPath: '/workspace/opencode.json',
            ccsConfigPath: '/workspace/config.yaml',
          },
          providers: ['ccs-claude'],
          defaultModel: 'ccs-claude/claude-sonnet-4',
          summary: 'Verified 1 CCS provider(s). Default model: ccs-claude/claude-sonnet-4.',
        })
      ),
      runWatchMode,
      readFile: vi.fn(),
      readDir: vi.fn(async () => []),
      writeFile: vi.fn(),
      discoverProviderModels: vi.fn(),
      pathExists: vi.fn(() => false),
      homeDir: '/home/test',
    });

    await customServer(createPluginInput());

    expect(runWatchMode).toHaveBeenCalledTimes(1);
    expect(runWatchMode).toHaveBeenCalledWith(
      expect.objectContaining({
        watch: true,
        cwd: '/workspace',
        homeDir: '/home/test',
      })
    );
  });

  it('returns structured JSON from the ccs_sync tool', async () => {
    const log = vi.fn(async () => undefined);
    const customServer = createServer({
      runSync: vi.fn(async () =>
        createSyncResult({
          ok: true,
          mode: 'sync',
          changed: true,
          resolvedPaths: {
            opencodeConfigPath: '/workspace/opencode.json',
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
            opencodeConfigPath: '/workspace/opencode.json',
            ccsConfigPath: '/workspace/config.yaml',
          },
          providers: ['ccs-claude'],
          defaultModel: 'ccs-claude/claude-sonnet-4',
          summary: 'Verified 1 CCS provider(s). Default model: ccs-claude/claude-sonnet-4.',
        })
      ),
      readFile: vi.fn(),
      readDir: vi.fn(async () => []),
      writeFile: vi.fn(),
      discoverProviderModels: vi.fn(),
      pathExists: vi.fn(() => false),
      homeDir: '/home/test',
    });

    const hooks = await customServer(createPluginInput(log));
    const execute = hooks.tool?.ccs_sync.execute;

    expect(execute).toBeDefined();

    const output = await execute!(
      { dryRun: true },
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
    expect(parsed.resolvedPaths.opencodeConfigPath).toBe('/workspace/opencode.json');
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('routes watch requests to the watch runtime helper', async () => {
    const runWatchMode = vi.fn(async () =>
      createSyncResult({
        ok: true,
        mode: 'watch',
        changed: false,
        resolvedPaths: {
          opencodeConfigPath: '/workspace/opencode.json',
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
      readDir: vi.fn(async () => []),
      writeFile: vi.fn(),
      discoverProviderModels: vi.fn(),
      pathExists: vi.fn(() => false),
      homeDir: '/home/test',
    });
    const hooks = await customServer(createPluginInput());

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

    expect(runWatchMode).toHaveBeenCalledTimes(2);
    expect(JSON.parse(output ?? '{}').mode).toBe('watch');
  });

  it('logs failures before rethrowing tool execution errors', async () => {
    const log = vi.fn(async () => undefined);
    const customServer = createServer({
      runSync: vi.fn(async () => {
        throw new Error('boom');
      }),
      runWatchMode: vi.fn(async () =>
        createSyncResult({
          ok: true,
          mode: 'watch',
          changed: false,
          resolvedPaths: {
            opencodeConfigPath: '/workspace/opencode.json',
            ccsConfigPath: '/workspace/config.yaml',
          },
          providers: ['ccs-claude'],
          defaultModel: 'ccs-claude/claude-sonnet-4',
          summary: 'Verified 1 CCS provider(s). Default model: ccs-claude/claude-sonnet-4.',
        })
      ),
      readFile: vi.fn(),
      readDir: vi.fn(async () => []),
      writeFile: vi.fn(),
      discoverProviderModels: vi.fn(),
      pathExists: vi.fn(() => false),
      homeDir: '/home/test',
    });
    const hooks = await customServer(createPluginInput(log));

    await expect(
      hooks.tool?.ccs_sync.execute(
        {},
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
      )
    ).rejects.toThrow('boom');

    expect(log).toHaveBeenCalledTimes(2);
  });
});
