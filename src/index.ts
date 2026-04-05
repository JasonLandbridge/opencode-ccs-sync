import type { Plugin, PluginModule } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { discoverProviderModels } from './cliproxy/client.js';
import type { ProbeProtocol } from './sync/protocol.js';
import { createCachedProtocolDetector } from './sync/protocol.js';
import { runSync } from './sync/service.js';
import { runWatchMode } from './watch/watch.js';

const PLUGIN_VERSION = '0.0.1';

interface PluginDependencies {
  runSync: typeof runSync;
  runWatchMode: typeof runWatchMode;
  readFile: typeof readFile;
  readDir: typeof readdir;
  writeFile: typeof writeFile;
  discoverProviderModels: typeof discoverProviderModels;
  detectProtocol: (input: { providerBaseUrl: string }) => Promise<ProbeProtocol>;
  pathExists: (filePath: string) => boolean;
  homeDir: string;
}

interface PluginLogger {
  app?: {
    log?: (input: {
      body: {
        service: string;
        level: 'debug' | 'info' | 'warn' | 'error';
        message: string;
        extra?: Record<string, unknown>;
      };
    }) => Promise<unknown> | unknown;
  };
}

async function logPluginEvent(
  client: PluginLogger,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, unknown>
): Promise<void> {
  await client.app?.log?.({
    body: {
      service: 'opencode-ccs-sync',
      level,
      message,
      extra,
    },
  });
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createDefaultDependencies(): PluginDependencies {
  const cachedDetector = createCachedProtocolDetector();
  return {
    runSync,
    runWatchMode,
    readFile,
    readDir: readdir,
    writeFile,
    discoverProviderModels,
    detectProtocol: ({ providerBaseUrl }) =>
      cachedDetector({ providerBaseUrl, pluginVersion: PLUGIN_VERSION }),
    pathExists: existsSync,
    homeDir: process.env.HOME ?? process.env.USERPROFILE ?? '',
  };
}

function createSharedOptions(
  dependencies: PluginDependencies,
  input: { directory: string },
  args: {
    dryRun?: boolean;
    watch?: boolean;
  },
  abortSignal: AbortSignal
) {
  return {
    dryRun: args.dryRun,
    watch: args.watch,
    cwd: input.directory,
    homeDir: dependencies.homeDir,
    abortSignal,
    pathExists: dependencies.pathExists,
    readFile: (filePath: string) => dependencies.readFile(filePath, 'utf8'),
    readDir: (directoryPath: string) => dependencies.readDir(directoryPath),
    writeFile: (filePath: string, content: string) =>
      dependencies.writeFile(filePath, content, 'utf8'),
    fetchModels: dependencies.discoverProviderModels,
    detectProtocol: dependencies.detectProtocol,
  };
}

export function createServer(dependencies: PluginDependencies): Plugin {
  return async (input) => {
    const startupAbortController = new AbortController();
    void dependencies
      .runWatchMode(
        createSharedOptions(
          dependencies,
          input,
          {
            watch: true,
          },
          startupAbortController.signal
        )
      )
      .catch(async (error: unknown) => {
        await logPluginEvent(input.client as PluginLogger, 'error', 'startup watch failed', {
          error: normalizeError(error),
          directory: input.directory,
        });
      });

    return {
      tool: {
        ccs_sync: tool({
          description: 'Synchronize CCS-managed providers and models into OpenCode by convention.',
          args: {
            dryRun: tool.schema.boolean().optional(),
            watch: tool.schema.boolean().optional(),
          },
          async execute(args, context) {
            await logPluginEvent(input.client as PluginLogger, 'info', 'ccs_sync started', {
              dryRun: args.dryRun ?? false,
              watch: args.watch ?? false,
              sessionID: context.sessionID,
              messageID: context.messageID,
              directory: context.directory,
            });

            const sharedOptions = createSharedOptions(dependencies, input, args, context.abort);

            try {
              const result = args.watch
                ? await dependencies.runWatchMode({ ...sharedOptions, abortSignal: context.abort })
                : await dependencies.runSync(sharedOptions);

              await logPluginEvent(input.client as PluginLogger, 'info', 'ccs_sync completed', {
                mode: result.mode,
                changed: result.changed,
                providers: result.providers,
                defaultModel: result.defaultModel ?? null,
                summary: result.summary,
                resolvedPaths: result.resolvedPaths,
              });

              return JSON.stringify(result, null, 2);
            } catch (error) {
              await logPluginEvent(input.client as PluginLogger, 'error', 'ccs_sync failed', {
                error: normalizeError(error),
                dryRun: args.dryRun ?? false,
                watch: args.watch ?? false,
              });
              throw error;
            }
          },
        }),
      },
    };
  };
}

const server: Plugin = createServer(createDefaultDependencies());

const pluginModule: PluginModule = {
  id: 'opencode-ccs-sync',
  server,
};

export { server };
export default pluginModule;
