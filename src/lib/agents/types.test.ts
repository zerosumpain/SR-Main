import { describe, it, expect } from 'vitest';
import { agentSlug, DEFAULT_AGENTS } from './types';

describe('agentSlug', () => {
  it('kebab-cases and trims', () => {
    expect(agentSlug('  My Research Bot! ')).toBe('my-research-bot');
    expect(agentSlug('Analyst')).toBe('analyst');
    expect(agentSlug('')).toBe('');
  });
});

describe('DEFAULT_AGENTS', () => {
  it('every default has a valid slug name, a role, a non-empty persona, and tool array', () => {
    for (const a of DEFAULT_AGENTS) {
      expect(a.name).toBe(agentSlug(a.name)); // names are already valid slugs
      expect(a.role.length).toBeGreaterThan(0);
      expect(a.persona.length).toBeGreaterThan(20);
      expect(Array.isArray(a.allowedTools)).toBe(true);
    }
  });

  it('has unique names', () => {
    const names = DEFAULT_AGENTS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
