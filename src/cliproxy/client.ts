import { nextBackoffDelayMs } from '../utils/backoff.js';

interface ModelRecord {
  id?: unknown;
}

interface ModelPayload {
  data?: ModelRecord[];
}

interface DiscoveryHttpError extends Error {
  status?: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DiscoverProviderModelsOptions {
  provider: string;
  runtimeBaseUrl: string;
  bearerToken: string;
  includeModelFamilies?: string[];
  fetchFn?: FetchLike;
  sleep?: (delayMs: number) => Promise<void>;
  abortSignal?: AbortSignal;
  maxAttempts?: number;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue: string = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

export function extractSortedModelIds(payload: unknown, includeFamilies?: string[]): string[] {
  const modelPayload: ModelPayload =
    typeof payload === 'object' && payload !== null ? (payload as ModelPayload) : {};
  const includePrefixes: string[] = (includeFamilies ?? [])
    .map((family) => family.trim())
    .filter((family) => family.length > 0)
    .sort((left, right) => left.localeCompare(right));

  const modelIds: string[] = Array.isArray(modelPayload.data)
    ? modelPayload.data
        .map((entry) => asNonEmptyString(entry.id))
        .filter((modelId): modelId is string => modelId !== undefined)
    : [];

  const filteredModelIds: string[] =
    includePrefixes.length === 0
      ? modelIds
      : modelIds.filter((modelId) => includePrefixes.some((prefix) => modelId.startsWith(prefix)));

  return Array.from(new Set(filteredModelIds)).sort((left, right) => left.localeCompare(right));
}

export function classifyRetryableDiscoveryError(error: unknown): 'retry' | 'fail' {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status: unknown = Reflect.get(error, 'status');
    if (typeof status === 'number') {
      if (status >= 400 && status < 500) {
        return 'fail';
      }

      if (status >= 500) {
        return 'retry';
      }
    }
  }

  if (error instanceof TypeError) {
    return 'retry';
  }

  const message: string =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    message.includes('econnrefused') ||
    message.includes('unavailable') ||
    message.includes('fetch failed')
  ) {
    return 'retry';
  }

  return 'fail';
}

function buildModelsEndpoint(runtimeBaseUrl: string, provider: string): string {
  const normalizedBaseUrl: string = runtimeBaseUrl.replace(/\/$/, '');
  return `${normalizedBaseUrl}/api/provider/${provider}/v1/models`;
}

function createHttpError(response: Response): DiscoveryHttpError {
  const error = new Error(
    `Model discovery failed with status ${response.status}`
  ) as DiscoveryHttpError;
  error.status = response.status;
  return error;
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function discoverProviderModels(
  options: DiscoverProviderModelsOptions
): Promise<string[]> {
  const fetchFn: FetchLike = options.fetchFn ?? fetch;
  const sleep: (delayMs: number) => Promise<void> = options.sleep ?? defaultSleep;
  const endpoint: string = buildModelsEndpoint(options.runtimeBaseUrl, options.provider);

  const maxAttempts = options.maxAttempts ?? 5;
  let attempt = 0;
  while (true) {
    try {
      const response = await fetchFn(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.bearerToken}`,
        },
        signal: options.abortSignal,
      });

      if (!response.ok) {
        throw createHttpError(response);
      }

      const payload = (await response.json()) as unknown;
      return extractSortedModelIds(payload, options.includeModelFamilies);
    } catch (error) {
      if (options.abortSignal?.aborted) {
        throw error;
      }

      if (classifyRetryableDiscoveryError(error) === 'fail') {
        throw error;
      }

      if (attempt >= maxAttempts - 1) {
        throw error;
      }

      await sleep(nextBackoffDelayMs(attempt));
      attempt += 1;
    }
  }
}

export { nextBackoffDelayMs };
