import path from 'node:path';

export interface ResolvePathOptions {
  explicitPath?: string;
  cwd: string;
  homeDir: string;
  exists?: (candidate: string) => boolean;
}

const OPEN_CODE_CONFIG_FILE_NAMES = ['opencode.json', 'opencode.jsonc'] as const;

function normalizeInputPath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/');
}

export function expandHomePath(inputPath: string, homeDir: string): string {
  if (inputPath === '~') {
    return homeDir;
  }

  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    const relativePath: string = normalizeInputPath(inputPath).slice(2);
    return path.join(homeDir, ...relativePath.split('/'));
  }

  return inputPath;
}

function defaultExists(): boolean {
  return false;
}

function resolveCandidatePath(candidate: string, homeDir: string): string {
  const expandedCandidate: string = expandHomePath(candidate, homeDir);
  return path.normalize(expandedCandidate);
}

export function resolveOpenCodeConfigPath(options: ResolvePathOptions): string {
  const exists: (candidate: string) => boolean = options.exists ?? defaultExists;

  if (options.explicitPath) {
    return resolveCandidatePath(options.explicitPath, options.homeDir);
  }

  for (const fileName of OPEN_CODE_CONFIG_FILE_NAMES) {
    const projectConfigPath = path.join(options.cwd, fileName);
    if (exists(projectConfigPath)) {
      return projectConfigPath;
    }
  }

  for (const fileName of OPEN_CODE_CONFIG_FILE_NAMES) {
    const globalConfigPath = path.join(options.homeDir, '.config', 'opencode', fileName);
    if (exists(globalConfigPath)) {
      return globalConfigPath;
    }
  }

  return path.join(options.homeDir, '.config', 'opencode', 'opencode.json');
}

export function resolveCcsConfigPath(options: ResolvePathOptions): string {
  if (options.explicitPath) {
    return resolveCandidatePath(options.explicitPath, options.homeDir);
  }

  return path.join(options.homeDir, '.ccs', 'config.yaml');
}
