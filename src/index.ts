import type { Plugin, PluginModule } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { readFile, writeFile } from 'node:fs/promises';
import { discoverProviderModels } from './cliproxy/client.js';
import { runSync } from './sync/service.js';
import { runWatchMode } from './watch/watch.js';

interface PluginDependencies {
  runSync: typeof runSync;
  runWatchMode: typeof runWatchMode;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  discoverProviderModels: typeof discoverProviderModels;
  homeDir: string;
}

function createDefaultDependencies(): PluginDependencies {
  return {
    runSync,
    runWatchMode,
    readFile,
    writeFile,
    discoverProviderModels,
    homeDir: process.env.HOME ?? process.env.USERPROFILE ?? '',
  };
}

export function createServer(dependencies: PluginDependencies): Plugin {
  return async () => ({
    tool: {
      ccs_sync: tool({
        description:
          'Synchronize CCS-managed providers and models into opencode.jsonc deterministically.',
        args: {
          opencodeConfigPath: tool.schema.string().optional(),
          ccsConfigPath: tool.schema.string().optional(),
          providers: tool.schema.array(tool.schema.string()).optional(),
          includeModelFamilies: tool.schema.array(tool.schema.string()).optional(),
          dryRun: tool.schema.boolean().optional(),
          watch: tool.schema.boolean().optional(),
        },
        async execute(args, context) {
          const sharedOptions = {
            dryRun: args.dryRun,
            watch: args.watch,
            cwd: context.directory,
            homeDir: dependencies.homeDir,
            opencodeConfigPath: args.opencodeConfigPath,
            ccsConfigPath: args.ccsConfigPath,
            providers: args.providers,
            includeModelFamilies: args.includeModelFamilies,
            abortSignal: context.abort,
            readFile: (filePath: string) => dependencies.readFile(filePath, 'utf8'),
            writeFile: (filePath: string, content: string) =>
              dependencies.writeFile(filePath, content, 'utf8'),
            fetchModels: dependencies.discoverProviderModels,
          };

          const result = args.watch
            ? await dependencies.runWatchMode({ ...sharedOptions, abortSignal: context.abort })
            : await dependencies.runSync(sharedOptions);

          return JSON.stringify(result, null, 2);
        },
      }),
    },
  });
}

const server: Plugin = createServer(createDefaultDependencies());

const pluginModule: PluginModule = {
  server,
};

export { server };
export default pluginModule;
