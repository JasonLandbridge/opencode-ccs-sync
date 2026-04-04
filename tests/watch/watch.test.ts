import { describe, expect, it, vi } from 'vitest';
import { createWriteLoopGuard } from '../../src/watch/watch.ts';

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
