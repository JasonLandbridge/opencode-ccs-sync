import { applyEdits, modify, parse } from 'jsonc-parser';

export interface ManagedSyncState {
  providers: Record<string, Record<string, unknown>>;
  models: Record<string, { provider: string; id: string }>;
  defaultModel: string;
}

interface OpenCodeConfig {
  provider?: Record<string, unknown>;
  models?: Record<string, unknown>;
}

const FORMATTING_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
};

function sortObjectEntries<T>(input: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right))
  ) as Record<string, T>;
}

function isManagedKey(key: string): boolean {
  return key.startsWith('ccs-');
}

function isManagedModelKey(key: string): boolean {
  return key.startsWith('ccs-');
}

function buildMergedProviders(
  config: OpenCodeConfig,
  state: ManagedSyncState
): Record<string, unknown> {
  const unmanagedProviders = Object.entries(config.provider ?? {}).filter(
    ([key]) => !isManagedKey(key)
  );

  return sortObjectEntries({
    ...Object.fromEntries(unmanagedProviders),
    ...state.providers,
  });
}

function buildMergedModels(
  config: OpenCodeConfig,
  state: ManagedSyncState
): Record<string, unknown> {
  const unmanagedModels = Object.entries(config.models ?? {}).filter(
    ([key]) => !isManagedModelKey(key)
  );

  return sortObjectEntries({
    ...Object.fromEntries(unmanagedModels),
    ...state.models,
  });
}

function applyJsoncEdit(input: string, path: (string | number)[], value: unknown): string {
  const edits = modify(input, path, value, { formattingOptions: FORMATTING_OPTIONS });
  return applyEdits(input, edits);
}

export function applyManagedConfigSync(input: string, state: ManagedSyncState): string {
  const config = parse(input) as OpenCodeConfig;

  let output = input;
  output = applyJsoncEdit(output, ['provider'], buildMergedProviders(config, state));
  output = applyJsoncEdit(output, ['models'], buildMergedModels(config, state));
  output = applyJsoncEdit(output, ['model'], state.defaultModel);

  return output;
}

export function hasEffectiveChanges(before: string, after: string): boolean {
  return before !== after;
}
