import { describe, expect, it } from 'vitest';
import { classifyContext } from './classify';

describe('classifyContext', () => {
  it('weights the current turn above older thread text', () => {
    const result = classifyContext({
      title: 'Researching recovery',
      messages: [
        { content: 'Find research papers about sleep.' },
        { content: 'Now compare my HRV and readiness over the last month.' },
      ],
    });
    expect(result.automaticLens).toBe('health');
    expect(result.lenses.find((l) => l.id === 'health')!.score)
      .toBeGreaterThan(result.lenses.find((l) => l.id === 'research')!.score);
  });

  it('uses structural research evidence without keywords', () => {
    const result = classifyContext({ messages: [{ content: 'What did it find?' }], graphKinds: ['run'] });
    expect(result.automaticLens).toBe('research');
  });

  it('falls back to general for an unclassified thread', () => {
    expect(classifyContext({ messages: [{ content: 'Hello there' }] }).automaticLens).toBe('general');
  });

  it('keeps general selected for a passing specialist reference', () => {
    expect(classifyContext({
      messages: [{ content: 'Can you include a source when you answer this?' }],
    }).automaticLens).toBe('general');
  });

  it('moves to health for a clearly health-related question', () => {
    expect(classifyContext({
      messages: [{ content: 'How was my sleep last night?' }],
    }).automaticLens).toBe('health');
  });

  it('does not mistake workspace language for health context', () => {
    expect(classifyContext({
      messages: [{ content: 'Run the build, check the workflow steps and reduce the bundle weight.' }],
    }).automaticLens).toBe('general');
  });
});
