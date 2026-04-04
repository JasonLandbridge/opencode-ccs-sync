import { describe, expect, it, vi } from 'vitest';
import {
  createWriteLoopGuard,
  resolveWatchPaths,
  shouldTriggerWatchSync,
} from '../../src/watch/watch.ts';

describe('createWriteLoopGuard', () => {
  it('suppresses a matching self-written hash during the suppression window', () => {
    const now = vi.fn(() => 1_000);
    const guard = createWriteLoopGuard({ suppressionWindowMs: 2_000, now });

    guard.markWritten('hash-1');

    expect(guard.shouldSuppress('hash-1')).toBe(true);
    expect(guard.shouldSuppress('hash-2')).toBe(false);
  });

  it('stops suppressing after the suppression window expires', () => {
    let currentTime = 1_000;
    const guard = createWriteLoopGuard({
      suppressionWindowMs: 500,
      now: () => currentTime,
    });

    guard.markWritten('hash-1');
    currentTime = 1_501;

    expect(guard.shouldSuppress('hash-1')).toBe(false);
  });
});

describe('resolveWatchPaths', () => {
  it('includes the CCS config directory so live settings-file edits are observed', () => {
    const watchPaths = resolveWatchPaths({
      ccsConfigPath: '/home/test/.ccs/config.yaml',
      opencodeConfigPath: '/workspace/opencode.json',
    });

    expect(watchPaths).toEqual([
      '/home/test/.ccs/config.yaml',
      '/workspace/opencode.json',
      '/home/test/.ccs',
    ]);
  });
});

describe('shouldTriggerWatchSync', () => {
  const resolvedPaths = {
    ccsConfigPath: '/home/test/.ccs/config.yaml',
    opencodeConfigPath: '/workspace/opencode.json',
  };

  it('triggers for live provider settings changes inside the CCS config directory', () => {
    expect(shouldTriggerWatchSync('/home/test/.ccs/codex.settings.json', resolvedPaths)).toBe(true);
    expect(shouldTriggerWatchSync('/home/test/.ccs/claude.settings.json', resolvedPaths)).toBe(
      true
    );
  });

  it('ignores unrelated files in the CCS config directory', () => {
    expect(shouldTriggerWatchSync('/home/test/.ccs/notes.txt', resolvedPaths)).toBe(false);
    expect(shouldTriggerWatchSync('/home/test/.ccs/logs/runtime.log', resolvedPaths)).toBe(false);
  });
});
