import { parseDocument } from 'yaml';

const DEFAULT_RUNTIME_BASE_URL: string = 'http://127.0.0.1:3456';
const DEFAULT_BEARER_TOKEN: string = 'ccs-internal-managed';

export interface NormalizedCcsConfig {
  runtimeBaseUrl: string;
  bearerToken: string;
  selectedProviders: string[];
  defaultProvider?: string;
  anthropicModel?: string;
}

interface RawEnvConfig {
  CLI_PROXY_BASE_URL?: unknown;
  ANTHROPIC_MODEL?: unknown;
}

interface RawCcsConfig {
  env?: RawEnvConfig;
  providers?: unknown;
  defaultProvider?: unknown;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue: string = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function normalizeProviders(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const providers: string[] = input
    .map((value) => asTrimmedString(value))
    .filter((value): value is string => value !== undefined);

  return Array.from(new Set(providers)).sort((left, right) => left.localeCompare(right));
}

export function parseCcsConfig(input: string): unknown {
  const document = parseDocument(input);
  if (document.errors.length > 0) {
    throw document.errors[0];
  }

  return document.toJS();
}

export function normalizeCcsConfig(input: unknown): NormalizedCcsConfig {
  const rawConfig: RawCcsConfig =
    typeof input === 'object' && input !== null ? (input as RawCcsConfig) : {};
  const env: RawEnvConfig = rawConfig.env ?? {};

  const selectedProviders: string[] = normalizeProviders(rawConfig.providers);
  const defaultProvider: string | undefined = asTrimmedString(rawConfig.defaultProvider);
  const anthropicModel: string | undefined = asTrimmedString(env.ANTHROPIC_MODEL);
  const runtimeBaseUrl: string =
    asTrimmedString(env.CLI_PROXY_BASE_URL) ?? DEFAULT_RUNTIME_BASE_URL;

  return {
    runtimeBaseUrl,
    bearerToken: DEFAULT_BEARER_TOKEN,
    selectedProviders,
    defaultProvider,
    anthropicModel,
  };
}
