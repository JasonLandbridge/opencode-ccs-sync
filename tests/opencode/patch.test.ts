import { describe, expect, it } from 'vitest';
import { applyManagedConfigSync, hasEffectiveChanges } from '../../src/opencode/patch.ts';

describe('OpenCode JSONC patching', () => {
  it('updates only ccs-managed entries and preserves comments', () => {
    const input = `{
  // keep me
  "provider": {
    "openai": {
      "npm": "x",
      "models": {
        "gpt-4": { "name": "GPT-4" }
      }
    },
    "ccs-old": {
      "npm": "old",
      "models": {
        "old-model": { "name": "Old Model" }
      }
    }
  }
}`;

    const output = applyManagedConfigSync(input, {
      providers: {
        'ccs-claude': {
          npm: 'pkg',
          models: {
            'claude-sonnet-4': {
              name: 'Claude Sonnet 4',
            },
          },
        },
      },
      defaultModel: 'ccs-claude/claude-sonnet-4',
    });

    expect(output).toContain('// keep me');
    expect(output).toContain('"openai"');
    expect(output).toContain('"gpt-4"');
    expect(output).not.toContain('"ccs-old"');
    expect(output).toContain('"ccs-claude"');
    expect(output).toContain('"claude-sonnet-4"');
    expect(output).toContain('"model": "ccs-claude/claude-sonnet-4"');
    expect(output).not.toContain('\n  "models": {');
    expect(output).not.toContain('"openai/gpt-4"');
  });

  it('detects when a second sync is idempotent', () => {
    const input = '{"provider":{},"model":""}';
    const firstPass = applyManagedConfigSync(input, {
      providers: {
        'ccs-claude': {
          npm: 'pkg',
          models: {
            'claude-sonnet-4': {
              name: 'Claude Sonnet 4',
            },
          },
        },
      },
      defaultModel: 'ccs-claude/claude-sonnet-4',
    });

    const secondPass = applyManagedConfigSync(firstPass, {
      providers: {
        'ccs-claude': {
          npm: 'pkg',
          models: {
            'claude-sonnet-4': {
              name: 'Claude Sonnet 4',
            },
          },
        },
      },
      defaultModel: 'ccs-claude/claude-sonnet-4',
    });

    expect(hasEffectiveChanges(firstPass, secondPass)).toBe(false);
  });
});
