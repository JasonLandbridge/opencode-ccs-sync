import { basename } from 'node:path';
import { parseDocument } from 'yaml';

const DEFAULT_RUNTIME_BASE_URL: string = 'http://127.0.0.1:3456';
const DEFAULT_BEARER_TOKEN: string = 'ccs-internal-managed';

export interface NormalizedCcsConfig {
  runtimeBaseUrl: string;
  bearerToken: string;
  selectedProviders: string[];
}

export interface ProviderSettingsMetadata {
  providerBaseUrl: string;
  selectedModels: string[];
  preferredModel: string | undefined;
}

interface RawEnvConfig {
  ANTHROPIC_MODEL?: unknown;
}

interface RawCliProxyConfig {
  providers?: unknown;
}

interface RawCliProxyServerLocalConfig {
  port?: unknown;
}

interface RawCliProxyServerConfig {
  local?: RawCliProxyServerLocalConfig;
}

interface RawProviderSettingsEnv {
  ANTHROPIC_BASE_URL?: unknown;
  ANTHROPIC_MODEL?: unknown;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: unknown;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: unknown;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: unknown;
}

interface RawProviderSettings {
  env?: RawProviderSettingsEnv;
}

interface RawCcsConfig {
  env?: RawEnvConfig;
  cliproxy?: RawCliProxyConfig;
  cliproxy_server?: RawCliProxyServerConfig;
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

function asPortNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsedValue = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }
  }

  return undefined;
}

function isProviderSettingsFile(fileName: string): boolean {
  return fileName.endsWith('.settings.json') && !fileName.startsWith('.');
}

function providerNameFromSettingsFile(fileName: string): string | undefined {
  if (!isProviderSettingsFile(fileName)) {
    return undefined;
  }

  return asTrimmedString(basename(fileName, '.settings.json'));
}

export function inferProvidersFromSettingsFiles(settingsFiles: Record<string, string>): string[] {
  const configuredProviders = Object.entries(settingsFiles)
    .map(([fileName, content]) => {
      const providerName = providerNameFromSettingsFile(fileName);
      if (!providerName) {
        return undefined;
      }

      try {
        const parsed = JSON.parse(content) as RawProviderSettings;
        const anthropicBaseUrl = asTrimmedString(parsed?.env?.ANTHROPIC_BASE_URL);
        const anthropicModel = asTrimmedString(parsed?.env?.ANTHROPIC_MODEL);

        return anthropicBaseUrl || anthropicModel ? providerName : undefined;
      } catch {
        return undefined;
      }
    })
    .filter((provider): provider is string => provider !== undefined);

  return Array.from(new Set(configuredProviders)).sort((left, right) => left.localeCompare(right));
}

export function inferProviderSelectionsFromSettingsFiles(
  settingsFiles: Record<string, string>
): Record<string, string[]> {
  const selections = Object.fromEntries(
    Object.entries(settingsFiles)
      .map(([fileName, content]) => {
        const providerName = providerNameFromSettingsFile(fileName);
        if (!providerName) {
          return undefined;
        }

        try {
          const parsed = JSON.parse(content) as RawProviderSettings;
          const env = parsed?.env;
          const anthropicBaseUrl = asTrimmedString(env?.ANTHROPIC_BASE_URL);
          if (!anthropicBaseUrl) {
            return undefined;
          }

          const selectedModels = [
            asTrimmedString(env?.ANTHROPIC_MODEL),
            asTrimmedString(env?.ANTHROPIC_DEFAULT_OPUS_MODEL),
            asTrimmedString(env?.ANTHROPIC_DEFAULT_SONNET_MODEL),
            asTrimmedString(env?.ANTHROPIC_DEFAULT_HAIKU_MODEL),
          ].filter((model): model is string => model !== undefined);

          const uniqueSelectedModels = Array.from(new Set(selectedModels)).sort((left, right) =>
            left.localeCompare(right)
          );

          return uniqueSelectedModels.length > 0 ? [providerName, uniqueSelectedModels] : undefined;
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is [string, string[]] => entry !== undefined)
  ) as Record<string, string[]>;

  return Object.fromEntries(
    Object.entries(selections).sort(([left], [right]) => left.localeCompare(right))
  );
}

export function inferProviderMetadataFromSettingsFiles(
  settingsFiles: Record<string, string>
): Record<string, ProviderSettingsMetadata> {
  const entries: Array<[string, ProviderSettingsMetadata]> = [];

  for (const [fileName, content] of Object.entries(settingsFiles)) {
    const providerName = providerNameFromSettingsFile(fileName);
    if (!providerName) {
      continue;
    }

    try {
      const parsed = JSON.parse(content) as RawProviderSettings;
      const env = parsed?.env;
      const anthropicBaseUrl = asTrimmedString(env?.ANTHROPIC_BASE_URL);
      if (!anthropicBaseUrl) {
        continue;
      }

      const selectedModels = [
        asTrimmedString(env?.ANTHROPIC_MODEL),
        asTrimmedString(env?.ANTHROPIC_DEFAULT_OPUS_MODEL),
        asTrimmedString(env?.ANTHROPIC_DEFAULT_SONNET_MODEL),
        asTrimmedString(env?.ANTHROPIC_DEFAULT_HAIKU_MODEL),
      ].filter((model): model is string => model !== undefined);

      entries.push([
        providerName,
        {
          providerBaseUrl: anthropicBaseUrl,
          selectedModels: Array.from(new Set(selectedModels)).sort((left, right) =>
            left.localeCompare(right)
          ),
          preferredModel: asTrimmedString(env?.ANTHROPIC_MODEL),
        },
      ]);
    } catch {
      continue;
    }
  }

  const metadata = Object.fromEntries(entries) as Record<string, ProviderSettingsMetadata>;

  return Object.fromEntries(
    Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))
  );
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
  const cliproxy: RawCliProxyConfig = rawConfig.cliproxy ?? {};
  const cliproxyServer: RawCliProxyServerConfig = rawConfig.cliproxy_server ?? {};

  const selectedProviders: string[] = normalizeProviders(cliproxy.providers);
  const derivedLocalRuntimeBaseUrl: string | undefined = (() => {
    const localPort = asPortNumber(cliproxyServer.local?.port);
    return localPort ? `http://127.0.0.1:${localPort}` : undefined;
  })();
  const runtimeBaseUrl: string = derivedLocalRuntimeBaseUrl ?? DEFAULT_RUNTIME_BASE_URL;

  return {
    runtimeBaseUrl,
    bearerToken: DEFAULT_BEARER_TOKEN,
    selectedProviders,
  };
}
