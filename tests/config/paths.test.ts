import { describe, expect, it } from 'vitest';
import {
  expandHomePath,
  resolveCcsConfigPath,
  resolveOpenCodeConfigPath,
} from '../../src/config/paths.ts';

describe('config path resolution', () => {
  it('expands a leading tilde with the provided home directory', () => {
    expect(expandHomePath('~/.config/opencode/opencode.jsonc', '/home/test')).toBe(
      '/home/test/.config/opencode/opencode.jsonc'
    );
  });

  it('prefers an explicit OpenCode config path', () => {
    expect(
      resolveOpenCodeConfigPath({
        explicitPath: '/tmp/custom.jsonc',
        cwd: '/workspace',
        homeDir: '/home/test',
        exists: () => false,
      })
    ).toBe('/tmp/custom.jsonc');
  });

  it('falls back to project opencode.jsonc before global config', () => {
    expect(
      resolveOpenCodeConfigPath({
        cwd: '/workspace',
        homeDir: '/home/test',
        exists: (candidate: string) => candidate === '/workspace/opencode.jsonc',
      })
    ).toBe('/workspace/opencode.jsonc');
  });

  it('falls back to the global OpenCode config when the project file is absent', () => {
    expect(
      resolveOpenCodeConfigPath({
        cwd: '/workspace',
        homeDir: '/home/test',
        exists: () => false,
      })
    ).toBe('/home/test/.config/opencode/opencode.jsonc');
  });

  it('falls back to ~/.ccs/config.yaml for CCS config', () => {
    expect(resolveCcsConfigPath({ cwd: '/workspace', homeDir: '/home/test' })).toBe(
      '/home/test/.ccs/config.yaml'
    );
  });
});
