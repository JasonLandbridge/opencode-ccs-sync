export function nextBackoffDelayMs(attempt: number, maxDelayMs: number = 30_000): number {
  const normalizedAttempt: number = Math.max(0, attempt);
  const nextDelayMs: number = 1_000 * 2 ** normalizedAttempt;
  return Math.min(nextDelayMs, maxDelayMs);
}
