import { watch } from 'chokidar';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

export async function runWatchMode(options: RunWatchModeOptions): Promise<SyncResult> {
  const guard = createWriteLoopGuard({ suppressionWindowMs: 1500 });
  let lastResult: SyncResult = await runSync({ ...options, watch: true });

  if (lastResult.changed && !options.dryRun) {
    const initialHash = await safeReadHash(lastResult.resolvedPaths.opencodeConfigPath);
    if (initialHash) {
      guard.markWritten(initialHash);
    }
  }

  const watcher = watch(
    [lastResult.resolvedPaths.ccsConfigPath, lastResult.resolvedPaths.opencodeConfigPath],
    {
      ignoreInitial: true,
    }
  );

  let running: Promise<void> | undefined;
  const triggerSync = async (changedPath: string): Promise<void> => {
    if (running) {
      return running;
    }

    running = (async () => {
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
