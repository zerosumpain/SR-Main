import { describe, it, expect } from 'vitest';
import { buildRevisionPrompt } from '$lib/workflows/orchestrator/prompts';

describe('buildRevisionPrompt', () => {
  it('returns a non-empty prompt string', () => {
    const prompt = buildRevisionPrompt();
    expect(prompt.length).toBeGreaterThan(50);
  });

  it('instructs the LLM to fix issues', () => {
    const prompt = buildRevisionPrompt();
    expect(prompt.toLowerCase()).toContain('fix');
  });

  it('reminds the LLM to call finalize_workflow', () => {
    const prompt = buildRevisionPrompt();
    expect(prompt).toContain('finalize_workflow');
  });
});
