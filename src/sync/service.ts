import type { ProviderConfig } from '@opencode-ai/sdk';
import { dirname, join } from 'node:path';
import {
  inferProviderSelectionsFromSettingsFiles,
  inferProvidersFromSettingsFiles,
  normalizeCcsConfig,
  parseCcsConfig,
} from '../config/ccs.js';
import { resolveCcsConfigPath, resolveOpenCodeConfigPath } from '../config/paths.js';
import { applyManagedConfigSync, hasEffectiveChanges } from '../opencode/patch.js';

export interface SyncResult {
  ok: boolean;
  mode: 'sync' | 'watch';
  changed: boolean;
  resolvedPaths: { opencodeConfigPath: string; ccsConfigPath: string };
  providers: string[];
  defaultModel?: string;
  summary: string;
  errors?: string[];
}

export interface RunSyncOptions {
  dryRun?: boolean;
  watch?: boolean;
  cwd: string;
  homeDir: string;
  opencodeConfigPath?: string;
  ccsConfigPath?: string;
  providers?: string[];
  includeModelFamilies?: string[];
  readFile: (filePath: string) => Promise<string>;
  readDir?: (directoryPath: string) => Promise<string[]>;
  writeFile: (filePath: string, content: string) => Promise<void> | void;
  abortSignal?: AbortSignal;
  fetchModels: (input: {
    provider: string;
    runtimeBaseUrl: string;
    bearerToken: string;
    includeModelFamilies?: string[];
    abortSignal?: AbortSignal;
  }) => Promise<string[]>;
}

type ProviderModelsConfig = Record<string, { name: string }>;
const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  agy: 'AGY',
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  ghcp: 'GitHub Copilot',
  iflow: 'iFlow',
  kimi: 'Kimi',
  kiro: 'Kiro',
  qwen: 'Qwen',
};
const DECIMAL_SENTINEL = 'DOTDECIMALTOKEN';

function toManagedProviderName(provider: string): string {
  return `ccs-${provider}`;
}

function normalizeRequestedProviders(providers: string[] | undefined): string[] {
  if (!providers || providers.length === 0) {
    return [];
  }

  return Array.from(new Set(providers.map((provider) => provider.trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right)
  );
}

function pickDefaultModel(input: {
  providers: string[];
  modelsByProvider: Record<string, string[]>;
  anthropicModel?: string;
}): string | undefined {
  const defaultProvider: string | undefined = [...input.providers].sort((left, right) =>
    left.localeCompare(right)
  )[0];

  if (!defaultProvider) {
    return undefined;
  }

  const discoveredModels: string[] = input.modelsByProvider[defaultProvider] ?? [];
  if (discoveredModels.length === 0) {
    return undefined;
  }

  const selectedModelId: string =
    input.anthropicModel && discoveredModels.includes(input.anthropicModel)
      ? input.anthropicModel
      : discoveredModels[0];

  return `${toManagedProviderName(defaultProvider)}/${selectedModelId}`;
}

const UPPERCASE_TOKENS: ReadonlySet<string> = new Set(['gpt', 'ccs', 'ghcp']);

function formatDisplayToken(token: string): string {
  if (/^\d+\.\d+$/.test(token)) {
    return token;
  }

  const lowerToken = token.toLowerCase();
  if (UPPERCASE_TOKENS.has(lowerToken)) {
    return lowerToken.toUpperCase();
  }

  if (/^\d+$/.test(token)) {
    return token;
  }

  return lowerToken.charAt(0).toUpperCase() + lowerToken.slice(1);
}

function normalizeDisplayTokens(tokens: string[]): string[] {
  const normalized: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];

    if (/^\d$/.test(current) && /^\d$/.test(next)) {
      normalized.push(`${current}.${next}`);
      index += 1;
      continue;
    }

    normalized.push(current);
  }

  return normalized;
}

function toDisplayName(modelId: string): string {
  const rawTokens: string[] = modelId
    .replace(/(\d)\.(\d)/g, `$1${DECIMAL_SENTINEL}$2`)
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => part.replaceAll(DECIMAL_SENTINEL, '.'));

  return normalizeDisplayTokens(rawTokens)
    .map((part) => formatDisplayToken(part))
    .join(' ');
}

function toProviderDisplayName(provider: string): string {
  return (
    PROVIDER_DISPLAY_NAMES[provider] ?? `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`
  );
}

function buildProviderModels(modelIds: string[]): ProviderModelsConfig {
  return Object.fromEntries(
    [...modelIds]
      .sort((left, right) => left.localeCompare(right))
      .map((modelId) => [modelId, { name: toDisplayName(modelId) }])
  );
}

function buildProviderConfig(
  provider: string,
  runtimeBaseUrl: string,
  bearerToken: string,
  modelIds: string[]
): ProviderConfig {
  const normalizedBaseUrl: string = runtimeBaseUrl.replace(/\/$/, '');

  return {
    npm: '@ai-sdk/openai-compatible',
    name: `CCS ${toProviderDisplayName(provider)}`,
    options: {
      baseURL: `${normalizedBaseUrl}/api/provider/${provider}/v1`,
      apiKey: bearerToken,
    },
    models: buildProviderModels(modelIds),
  };
}

function buildSummary(
  changed: boolean,
  defaultModel: string | undefined,
  providerCount: number
): string {
  if (providerCount === 0) {
    return 'No CCS providers were available to sync.';
  }

  const action: string = changed ? 'Updated' : 'Verified';
  const modelSummary: string = defaultModel ? ` Default model: ${defaultModel}.` : '';
  return `${action} ${providerCount} CCS provider(s).${modelSummary}`;
}

async function discoverConfiguredProviders(options: {
  ccsConfigPath: string;
  readDir?: (directoryPath: string) => Promise<string[]>;
  readFile: (filePath: string) => Promise<string>;
}): Promise<{ providers: string[]; selectedModelsByProvider: Record<string, string[]> }> {
  if (!options.readDir) {
    return { providers: [], selectedModelsByProvider: {} };
  }

  const configDirectoryPath = dirname(options.ccsConfigPath);
  const entries = await options.readDir(configDirectoryPath).catch(() => []);
  const settingsEntries = entries.filter((entry) => entry.endsWith('.settings.json'));

  const settingsFiles = Object.fromEntries(
    await Promise.all(
      settingsEntries.map(async (entry) => [
        entry,
        await options.readFile(join(configDirectoryPath, entry)),
      ])
    )
  ) as Record<string, string>;

  return {
    providers: inferProvidersFromSettingsFiles(settingsFiles),
    selectedModelsByProvider: inferProviderSelectionsFromSettingsFiles(settingsFiles),
  };
}

export async function runSync(options: RunSyncOptions): Promise<SyncResult> {
  const opencodeConfigPath: string = resolveOpenCodeConfigPath({
    explicitPath: options.opencodeConfigPath,
    cwd: options.cwd,
    homeDir: options.homeDir,
  });
  const ccsConfigPath: string = resolveCcsConfigPath({
    explicitPath: options.ccsConfigPath,
    cwd: options.cwd,
    homeDir: options.homeDir,
  });

  const [ccsConfigText, opencodeConfigText, configuredSelections] = await Promise.all([
    options.readFile(ccsConfigPath),
    options.readFile(opencodeConfigPath),
    discoverConfiguredProviders({
      ccsConfigPath,
      readDir: options.readDir,
      readFile: options.readFile,
    }),
  ]);

  const normalizedCcsConfig = normalizeCcsConfig(parseCcsConfig(ccsConfigText));
  const requestedProviders = normalizeRequestedProviders(options.providers);
  const configuredProviders = configuredSelections.providers;
  const selectedProviders: string[] =
    requestedProviders.length > 0
      ? requestedProviders
      : configuredProviders.length > 0
        ? configuredProviders
        : normalizedCcsConfig.selectedProviders;

  const modelsByProvider: Record<string, string[]> = {};
  for (const provider of selectedProviders) {
    const discoveredModels: string[] = await options.fetchModels({
      provider,
      runtimeBaseUrl: normalizedCcsConfig.runtimeBaseUrl,
      bearerToken: normalizedCcsConfig.bearerToken,
      includeModelFamilies: options.includeModelFamilies,
      abortSignal: options.abortSignal,
    });

    const explicitSelectedModels = configuredSelections.selectedModelsByProvider[provider] ?? [];
    const allowedModels =
      explicitSelectedModels.length > 0
        ? explicitSelectedModels.filter((model) => discoveredModels.includes(model))
        : discoveredModels;

    modelsByProvider[provider] = [...allowedModels].sort((left, right) =>
      left.localeCompare(right)
    );
  }

  const defaultModel: string | undefined = pickDefaultModel({
    providers: selectedProviders,
    modelsByProvider,
    anthropicModel: normalizedCcsConfig.anthropicModel,
  });

  const managedProviders: Record<string, ProviderConfig> = Object.fromEntries(
    selectedProviders.map((provider) => [
      toManagedProviderName(provider),
      buildProviderConfig(
        provider,
        normalizedCcsConfig.runtimeBaseUrl,
        normalizedCcsConfig.bearerToken,
        modelsByProvider[provider] ?? []
      ),
    ])
  );

  const nextConfigText: string = applyManagedConfigSync(opencodeConfigText, {
    providers: managedProviders,
    defaultModel: defaultModel ?? '',
  });
  const changed: boolean = hasEffectiveChanges(opencodeConfigText, nextConfigText);

  if (changed && !options.dryRun) {
    await options.writeFile(opencodeConfigPath, nextConfigText);
  }

  return {
    ok: true,
    mode: options.watch ? 'watch' : 'sync',
    changed,
    resolvedPaths: {
      opencodeConfigPath,
      ccsConfigPath,
    },
    providers: selectedProviders.map((provider) => toManagedProviderName(provider)),
    defaultModel,
    summary: buildSummary(changed, defaultModel, selectedProviders.length),
  };
}
