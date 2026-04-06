import { watch } from 'chokidar';
import { createHash } from 'node:crypto';
import { dirname, normalize } from 'node:path';
import { readFile } from 'node:fs/promises';
import { resolveCcsConfigPath, resolveOpenCodeConfigPath } from '../config/paths.js';
import { applyManagedConfigSync, hasEffectiveChanges } from '../opencode/patch.js';
import type { RunSyncOptions, SyncResult } from '../sync/service.js';
import { runSync } from '../sync/service.js';

export interface WriteLoopGuard {
  markWritten(contentHash: string): void;
  shouldSuppress(contentHash: string): boolean;
}

interface WriteLoopGuardOptions {
  suppressionWindowMs: number;
  now?: () => number;
}

export interface RunWatchModeOptions extends RunSyncOptions {
  abortSignal: AbortSignal;
}

export function createWriteLoopGuard(options: WriteLoopGuardOptions): WriteLoopGuard {
  const now: () => number = options.now ?? (() => Date.now());
  let lastWrittenHash: string | undefined;
  let lastWrittenAt = 0;

  return {
    markWritten(contentHash: string): void {
      lastWrittenHash = contentHash;
      lastWrittenAt = now();
    },
    shouldSuppress(contentHash: string): boolean {
      if (!lastWrittenHash || contentHash !== lastWrittenHash) {
        return false;
      }

      return now() - lastWrittenAt <= options.suppressionWindowMs;
    },
  };
}

function hashContent(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

async function safeReadHash(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, 'utf8');
    return hashContent(content);
  } catch {
    return undefined;
  }
}

function normalizePath(filePath: string): string {
  return normalize(filePath);
}

export function resolveWatchPaths(resolvedPaths: {
  ccsConfigPath: string;
  opencodeConfigPath: string;
}): string[] {
  const ccsConfigPath = normalizePath(resolvedPaths.ccsConfigPath);
  const opencodeConfigPath = normalizePath(resolvedPaths.opencodeConfigPath);
  const ccsDirectoryPath = dirname(ccsConfigPath);

  return [ccsConfigPath, opencodeConfigPath, ccsDirectoryPath];
}

export function shouldTriggerWatchSync(
  changedPath: string,
  resolvedPaths: {
    ccsConfigPath: string;
    opencodeConfigPath: string;
  }
): boolean {
  const normalizedChangedPath = normalizePath(changedPath);
  const ccsConfigPath = normalizePath(resolvedPaths.ccsConfigPath);
  const opencodeConfigPath = normalizePath(resolvedPaths.opencodeConfigPath);
  const ccsDirectoryPath = dirname(ccsConfigPath);

  if (normalizedChangedPath === ccsConfigPath || normalizedChangedPath === opencodeConfigPath) {
    return true;
  }

  if (!normalizedChangedPath.startsWith(`${ccsDirectoryPath}/`)) {
    return false;
  }

  const fileName = normalizedChangedPath.slice(ccsDirectoryPath.length + 1);
  if (fileName.includes('/')) {
    return false;
  }

  return fileName.endsWith('.settings.json');
}

async function clearManagedProviders(options: RunWatchModeOptions, resolvedPaths: { opencodeConfigPath: string; ccsConfigPath: string }): Promise<void> {
  try {
    const currentConfig = await options.readFile(resolvedPaths.opencodeConfigPath);
    const cleared = applyManagedConfigSync(currentConfig, { providers: {}, defaultModel: '' });
    if (hasEffectiveChanges(currentConfig, cleared)) {
      await options.writeFile(resolvedPaths.opencodeConfigPath, cleared);
    }
  } catch {
    // If config is unreadable/unwritable, there's nothing to clear
  }
}

export async function runWatchMode(options: RunWatchModeOptions): Promise<SyncResult> {
  const guard = createWriteLoopGuard({ suppressionWindowMs: 1500 });

  let lastResult: SyncResult;
  try {
    lastResult = await runSync({ ...options, watch: true });
  } catch (startupError) {
    // CCS/CLIProxy unavailable on startup — resolve paths independently and clear stale
    // ccs-* providers from opencode.json so broken entries don't persist across restarts.
    const opencodeConfigPath = resolveOpenCodeConfigPath({
      explicitPath: options.opencodeConfigPath,
      cwd: options.cwd,
      homeDir: options.homeDir,
      exists: options.pathExists,
    });
    const ccsConfigPath = resolveCcsConfigPath({
      explicitPath: options.ccsConfigPath,
      cwd: options.cwd,
      homeDir: options.homeDir,
    });
    const resolvedPaths = { opencodeConfigPath, ccsConfigPath };

    if (!options.dryRun) {
      await clearManagedProviders(options, resolvedPaths);
    }

    // Synthesize a failed result so watch mode can still set up file watching.
    // When CCS becomes available and writes a .settings.json, the next sync will succeed.
    lastResult = {
      ok: false,
      mode: 'watch',
      changed: false,
      resolvedPaths,
      providers: [],
      summary: 'CCS startup sync failed — waiting for CCS to become available.',
    };
  }

  if (lastResult.changed && !options.dryRun) {
    const initialHash = await safeReadHash(lastResult.resolvedPaths.opencodeConfigPath);
    if (initialHash) {
      guard.markWritten(initialHash);
    }
  }

  const watcher = watch(resolveWatchPaths(lastResult.resolvedPaths), {
    ignoreInitial: true,
  });

  let running: Promise<void> | undefined;
  const triggerSync = async (changedPath: string): Promise<void> => {
    if (running) {
      return running;
    }

    running = (async () => {
      if (!shouldTriggerWatchSync(changedPath, lastResult.resolvedPaths)) {
        return;
      }

      if (changedPath === lastResult.resolvedPaths.opencodeConfigPath) {
        const currentHash = await safeReadHash(changedPath);
        if (currentHash && guard.shouldSuppress(currentHash)) {
          return;
        }
      }

      lastResult = await runSync({ ...options, watch: true });
      if (lastResult.changed && !options.dryRun) {
        const currentHash = await safeReadHash(lastResult.resolvedPaths.opencodeConfigPath);
        if (currentHash) {
          guard.markWritten(currentHash);
        }
      }
    })().finally(() => {
      running = undefined;
    });

    await running;
  };

  watcher.on('change', (changedPath: string) => {
    void triggerSync(changedPath);
  });
  watcher.on('add', (changedPath: string) => {
    void triggerSync(changedPath);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      options.abortSignal.addEventListener('abort', () => resolve(), { once: true });
      watcher.on('error', reject);
    });
  } finally {
    await watcher.close();
  }

  return lastResult;
}
