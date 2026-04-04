import { describe, expect, it } from 'vitest';
import { applyManagedConfigSync, hasEffectiveChanges } from '../../src/opencode/patch.ts';

describe('OpenCode JSONC patching', () => {
  it('updates only ccs-managed entries and preserves comments', () => {
    const input = `{
  // keep me
  "provider": {
    "openai": { "npm": "x" },
    "ccs-old": { "npm": "old" }
  },
  "models": {
    "openai/gpt-4": { "provider": "openai", "id": "gpt-4" }
  }
}`;

    const output = applyManagedConfigSync(input, {
      providers: {
        'ccs-claude': { npm: 'pkg' },
      },
      models: {
        'ccs-claude/claude-sonnet-4': {
          provider: 'ccs-claude',
          id: 'claude-sonnet-4',
        },
      },
      defaultModel: 'ccs-claude/claude-sonnet-4',
    });

    expect(output).toContain('// keep me');
    expect(output).toContain('"openai"');
    expect(output).not.toContain('"ccs-old"');
    expect(output).toContain('"ccs-claude/claude-sonnet-4"');
    expect(output).toContain('"model": "ccs-claude/claude-sonnet-4"');
  });

  it('detects when a second sync is idempotent', () => {
    const input = '{"provider":{},"models":{},"model":""}';
    const firstPass = applyManagedConfigSync(input, {
      providers: {
        'ccs-claude': { npm: 'pkg' },
      },
      models: {
        'ccs-claude/claude-sonnet-4': {
          provider: 'ccs-claude',
          id: 'claude-sonnet-4',
        },
      },
      defaultModel: 'ccs-claude/claude-sonnet-4',
    });

    const secondPass = applyManagedConfigSync(firstPass, {
      providers: {
        'ccs-claude': { npm: 'pkg' },
      },
      models: {
        'ccs-claude/claude-sonnet-4': {
          provider: 'ccs-claude',
          id: 'claude-sonnet-4',
        },
      },
      defaultModel: 'ccs-claude/claude-sonnet-4',
    });

    expect(hasEffectiveChanges(firstPass, secondPass)).toBe(false);
  });
});
