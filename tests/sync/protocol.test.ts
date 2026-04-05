import { describe, expect, it } from 'vitest';
import { probeProviderProtocol } from '../../src/sync/protocol.ts';

function makeFetch(
  responses: Array<{ status: number; headers?: Record<string, string>; body: string }>
): (input: string) => Promise<Response> {
  let index = 0;
  return async (_input: string) => {
    const def = responses[index] ?? responses[responses.length - 1];
    index += 1;
    const headers = new Headers(def.headers ?? {});
    return new Response(def.body, { status: def.status, headers });
  };
}

describe('probeProviderProtocol', () => {
  it('detects anthropic from text/event-stream content-type', async () => {
    const fetchFn = makeFetch([
      { status: 200, headers: { 'content-type': 'text/event-stream' }, body: '' },
    ]);
    const result = await probeProviderProtocol({
      providerBaseUrl: 'http://localhost:8317/api/provider/claude',
      fetchFn,
    });
    expect(result).toBe('anthropic');
  });

  it('detects anthropic from SSE body prefix "event:"', async () => {
    const fetchFn = makeFetch([{ status: 200, headers: {}, body: 'event: message\ndata: {}\n\n' }]);
    const result = await probeProviderProtocol({
      providerBaseUrl: 'http://localhost:8317/api/provider/claude',
      fetchFn,
    });
    expect(result).toBe('anthropic');
  });

  it('detects anthropic from SSE body prefix "data:"', async () => {
    const fetchFn = makeFetch([{ status: 200, headers: {}, body: 'data: {"type":"ping"}\n\n' }]);
    const result = await probeProviderProtocol({
      providerBaseUrl: 'http://localhost:8317/api/provider/codex',
      fetchFn,
    });
    expect(result).toBe('anthropic');
  });

  it('detects openai-compatible from application/json content-type', async () => {
    const fetchFn = makeFetch([
      { status: 200, headers: { 'content-type': 'application/json' }, body: '{"object":"list"}' },
    ]);
    const result = await probeProviderProtocol({
      providerBaseUrl: 'http://localhost:8317/api/provider/codex',
      fetchFn,
    });
    expect(result).toBe('openai-compatible');
  });

  it('detects openai-compatible from valid JSON body with no explicit content-type', async () => {
    const fetchFn = makeFetch([{ status: 200, headers: {}, body: '{"data":[]}' }]);
    const result = await probeProviderProtocol({
      providerBaseUrl: 'http://localhost:8317/api/provider/codex',
      fetchFn,
    });
    expect(result).toBe('openai-compatible');
  });

  it('falls back to /models on 404 and detects protocol there', async () => {
    const fetchFn = makeFetch([
      { status: 404, headers: {}, body: 'not found' },
      { status: 200, headers: { 'content-type': 'application/json' }, body: '{"data":[]}' },
    ]);
    const result = await probeProviderProtocol({
      providerBaseUrl: 'http://localhost:8317/api/provider/codex',
      fetchFn,
    });
    expect(result).toBe('openai-compatible');
  });

  it('falls back to /v1/models on second 404 and detects protocol there', async () => {
    const fetchFn = makeFetch([
      { status: 404, headers: {}, body: '' },
      { status: 404, headers: {}, body: '' },
      { status: 200, headers: { 'content-type': 'text/event-stream' }, body: '' },
    ]);
    const result = await probeProviderProtocol({
      providerBaseUrl: 'http://localhost:8317/api/provider/claude',
      fetchFn,
    });
    expect(result).toBe('anthropic');
  });

  it('returns unknown when all three probes return non-2xx', async () => {
    const fetchFn = makeFetch([
      { status: 500, headers: {}, body: '' },
      { status: 500, headers: {}, body: '' },
      { status: 500, headers: {}, body: '' },
    ]);
    const result = await probeProviderProtocol({
      providerBaseUrl: 'http://localhost:8317/api/provider/claude',
      fetchFn,
    });
    expect(result).toBe('unknown');
  });

  it('returns unknown when fetch throws a network error', async () => {
    const fetchFn = async (_input: string): Promise<Response> => {
      throw new TypeError('fetch failed');
    };
    const result = await probeProviderProtocol({
      providerBaseUrl: 'http://localhost:8317/api/provider/claude',
      fetchFn,
    });
    expect(result).toBe('unknown');
  });
});
