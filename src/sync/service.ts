import type { ProviderConfig } from '@opencode-ai/sdk';
import { normalizeCcsConfig, parseCcsConfig } from '../config/ccs.js';
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

function buildProviderConfig(
  provider: string,
  runtimeBaseUrl: string,
  bearerToken: string
): ProviderConfig {
  const normalizedBaseUrl: string = runtimeBaseUrl.replace(/\/$/, '');

  return {
    npm: '@ai-sdk/openai-compatible',
    name: `CCS ${provider.charAt(0).toUpperCase()}${provider.slice(1)}`,
    options: {
      baseURL: `${normalizedBaseUrl}/api/provider/${provider}/v1`,
      apiKey: bearerToken,
    },
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

  const [ccsConfigText, opencodeConfigText] = await Promise.all([
    options.readFile(ccsConfigPath),
    options.readFile(opencodeConfigPath),
  ]);

  const normalizedCcsConfig = normalizeCcsConfig(parseCcsConfig(ccsConfigText));
  const selectedProviders: string[] =
    normalizeRequestedProviders(options.providers).length > 0
      ? normalizeRequestedProviders(options.providers)
      : normalizedCcsConfig.selectedProviders;

  const modelsByProvider: Record<string, string[]> = {};
  for (const provider of selectedProviders) {
    const models: string[] = await options.fetchModels({
      provider,
      runtimeBaseUrl: normalizedCcsConfig.runtimeBaseUrl,
      bearerToken: normalizedCcsConfig.bearerToken,
      includeModelFamilies: options.includeModelFamilies,
      abortSignal: options.abortSignal,
    });
    modelsByProvider[provider] = [...models].sort((left, right) => left.localeCompare(right));
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
        normalizedCcsConfig.bearerToken
      ),
    ])
  );

  const managedModels: Record<string, { provider: string; id: string }> = Object.fromEntries(
    selectedProviders.flatMap((provider) =>
      (modelsByProvider[provider] ?? []).map((modelId) => [
        `${toManagedProviderName(provider)}/${modelId}`,
        { provider: toManagedProviderName(provider), id: modelId },
      ])
    )
  );

  const nextConfigText: string = applyManagedConfigSync(opencodeConfigText, {
    providers: managedProviders,
    models: managedModels,
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
