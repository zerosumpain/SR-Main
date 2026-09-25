import { describe, it, expect } from 'vitest';
import { openaiTools } from '$lib/workflows/orchestrator/tools';

/**
 * A free-form `config` was emitted as `{type:'object', properties:{}}` — an
 * object that may hold NOTHING. The Codex default model honoured that literally
 * and sent `config: {}` on every use_node / set_trigger / update_node, so a
 * cron had no expression and an LLM step no prompt, and the generator looped
 * for 30 rounds (2026-09-25). Every catch-all object must advertise
 * additionalProperties.
 */
function params(name: string): any {
  const t = (openaiTools as any[]).find((x) => x.function?.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t.function.parameters;
}

describe('generator tool schemas — free-form objects stay open', () => {
  for (const [tool, key] of [
    ['use_node', 'config'],
    ['update_node', 'config'],
    ['set_trigger', 'config'],
  ] as const) {
    it(`${tool}.${key} allows arbitrary keys`, () => {
      const p = params(tool).properties[key];
      expect(p.type).toBe('object');
      expect(p.additionalProperties).toBeTruthy();
    });
  }
});
