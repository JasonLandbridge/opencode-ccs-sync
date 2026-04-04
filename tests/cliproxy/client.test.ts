import { describe, expect, it, vi } from 'vitest';
import {
  classifyRetryableDiscoveryError,
  discoverProviderModels,
  extractSortedModelIds,
  type FetchLike,
} from '../../src/cliproxy/client.ts';

describe('model discovery helpers', () => {
  it('deduplicates and sorts model ids lexicographically', () => {
    expect(
      extractSortedModelIds({ data: [{ id: 'z' }, { id: 'a' }, { id: 'a' }] }, undefined)
    ).toEqual(['a', 'z']);
  });

  it('filters to matching include families when provided', () => {
    expect(
      extractSortedModelIds(
        {
          data: [{ id: 'claude-sonnet-4' }, { id: 'gpt-5' }, { id: 'claude-opus-4' }],
        },
        ['claude']
      )
    ).toEqual(['claude-opus-4', 'claude-sonnet-4']);
  });

  it('treats 4xx responses as non-retryable', () => {
    expect(classifyRetryableDiscoveryError({ status: 404 })).toBe('fail');
  });

  it('treats connection failures as retryable', () => {
    expect(classifyRetryableDiscoveryError(new TypeError('fetch failed'))).toBe('retry');
  });

  it('fetches provider models from the OpenAI-compatible CLIProxy endpoint', async () => {
    const fetchFn: FetchLike = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 'claude-sonnet-4' }, { id: 'claude-opus-4' }, { id: 'claude-sonnet-4' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
    );

    const models = await discoverProviderModels({
      provider: 'claude',
      runtimeBaseUrl: 'http://127.0.0.1:3456/',
      bearerToken: 'ccs-internal-managed',
      includeModelFamilies: ['claude'],
      fetchFn,
      sleep: async () => {},
    });

    expect(models).toEqual(['claude-opus-4', 'claude-sonnet-4']);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:3456/api/provider/claude/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ccs-internal-managed',
        }),
      })
    );
  });

  it('retries retryable discovery failures before succeeding', async () => {
    const fetchFn: FetchLike = vi
      .fn<(_: string, __?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    const sleep = vi.fn(async () => {});

    const models = await discoverProviderModels({
      provider: 'claude',
      runtimeBaseUrl: 'http://127.0.0.1:3456',
      bearerToken: 'ccs-internal-managed',
      fetchFn,
      sleep,
    });

    expect(models).toEqual(['claude-sonnet-4']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on non-retryable 4xx discovery responses', async () => {
    const fetchFn: FetchLike = vi.fn(async () => new Response('missing', { status: 404 }));

    await expect(
      discoverProviderModels({
        provider: 'claude',
        runtimeBaseUrl: 'http://127.0.0.1:3456',
        bearerToken: 'ccs-internal-managed',
        fetchFn,
        sleep: async () => {},
      })
    ).rejects.toThrow(/404/);
  });
});
