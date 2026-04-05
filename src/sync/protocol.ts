export type ProbeProtocol = 'anthropic' | 'openai-compatible' | 'unknown';

export type ProtocolFetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProbeProviderProtocolOptions {
  providerBaseUrl: string;
  fetchFn?: ProtocolFetchLike;
  timeoutMs?: number;
}

const PROBE_TIMEOUT_MS = 2500;

function classifyResponse(contentType: string, body: string): ProbeProtocol | null {
  const normalizedContentType = contentType.toLowerCase();

  if (normalizedContentType.includes('text/event-stream')) {
    return 'anthropic';
  }

  const trimmedBody = body.trimStart();
  if (trimmedBody.startsWith('event:') || trimmedBody.startsWith('data:')) {
    return 'anthropic';
  }

  if (normalizedContentType.includes('application/json')) {
    return 'openai-compatible';
  }

  try {
    JSON.parse(body);
    return 'openai-compatible';
  } catch {
    return null;
  }
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  try {
    const reader = response.body?.getReader();
    if (!reader) {
      return await response.text();
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.byteLength;
    }

    reader.cancel().catch(() => undefined);

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(merged);
  } catch {
    return '';
  }
}

async function probeUrl(
  url: string,
  fetchFn: ProtocolFetchLike,
  timeoutMs: number
): Promise<ProbeProtocol | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json, text/event-stream' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const bodyText = await readLimitedBody(response, 256);

    return classifyResponse(contentType, bodyText);
  } catch {
    return null;
  }
}

export async function probeProviderProtocol(
  options: ProbeProviderProtocolOptions
): Promise<ProbeProtocol> {
  const fetchFn: ProtocolFetchLike = options.fetchFn ?? fetch;
  const timeoutMs: number = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const base = options.providerBaseUrl.replace(/\/$/, '');

  const probeUrls = [base, `${base}/models`, `${base}/v1/models`];

  for (const url of probeUrls) {
    const result = await probeUrl(url, fetchFn, timeoutMs);
    if (result !== null) {
      return result;
    }
  }

  return 'unknown';
}

export interface CachedDetectorOptions {
  providerBaseUrl: string;
  pluginVersion: string;
}

interface CacheEntry {
  protocol: ProbeProtocol;
  providerBaseUrl: string;
  pluginVersion: string;
}

/**
 * Returns an in-memory cached wrapper around probeProviderProtocol.
 * Cache is invalidated when providerBaseUrl or pluginVersion changes.
 */
export function createCachedProtocolDetector(
  fetchFn?: ProtocolFetchLike
): (options: CachedDetectorOptions) => Promise<ProbeProtocol> {
  const cache = new Map<string, CacheEntry>();

  return async (options: CachedDetectorOptions): Promise<ProbeProtocol> => {
    const existing = cache.get(options.providerBaseUrl);
    if (
      existing &&
      existing.providerBaseUrl === options.providerBaseUrl &&
      existing.pluginVersion === options.pluginVersion
    ) {
      return existing.protocol;
    }

    const protocol = await probeProviderProtocol({
      providerBaseUrl: options.providerBaseUrl,
      fetchFn,
    });

    cache.set(options.providerBaseUrl, {
      protocol,
      providerBaseUrl: options.providerBaseUrl,
      pluginVersion: options.pluginVersion,
    });

    return protocol;
  };
}
