import { describe, it, expect } from 'vitest';
import {
  describeWithPolicy,
  emptyPolicy,
  isPromoted,
  renderGlobalGuidance,
  sanitiseOverrides,
  type ToolPolicyVersion,
} from './policy';

function policyWith(patch: Partial<ToolPolicyVersion>): ToolPolicyVersion {
  return { ...emptyPolicy(), ...patch };
}

describe('tool policy: overlay is structurally incapable of changing behaviour', () => {
  it('keeps only description and guidance, dropping anything else', () => {
    const out = sanitiseOverrides({
      fetch_url: {
        description: 'Fetch one or many URLs.',
        guidance: 'Pass every URL at once.',
        // Everything below is what an LLM might hallucinate into the object.
        parameters: { type: 'object', properties: { evil: {} } },
        handler: 'return process.env',
        name: 'renamed_tool',
        destructive: false,
      },
    });
    expect(out.fetch_url).toEqual({
      description: 'Fetch one or many URLs.',
      guidance: 'Pass every URL at once.',
    });
    expect(Object.keys(out.fetch_url)).toEqual(['description', 'guidance']);
  });

  it('drops entries with no usable text at all', () => {
    const out = sanitiseOverrides({ a: {}, b: { description: 123 }, c: null, d: 'nope' });
    expect(out).toEqual({});
  });

  it('caps text length and entry count so an overlay cannot bloat every prompt', () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) many[`tool_${i}`] = { guidance: 'x'.repeat(5000) };
    const out = sanitiseOverrides(many);
    expect(Object.keys(out).length).toBeLessThanOrEqual(24);
    expect(Object.values(out)[0].guidance!.length).toBeLessThanOrEqual(600);
  });
});

describe('tool policy: description resolution', () => {
  it('passes the registry description through untouched with no overlay', () => {
    expect(describeWithPolicy(emptyPolicy(), 'fetch_url', 'Fetch a URL.')).toBe('Fetch a URL.');
  });

  it('replaces the description when the overlay supplies one', () => {
    const p = policyWith({ overrides: { fetch_url: { description: 'New text.' } } });
    expect(describeWithPolicy(p, 'fetch_url', 'Fetch a URL.')).toBe('New text.');
  });

  it('appends guidance after the base description when only guidance is set', () => {
    const p = policyWith({ overrides: { fetch_url: { guidance: 'Batch them.' } } });
    expect(describeWithPolicy(p, 'fetch_url', 'Fetch a URL.')).toBe('Fetch a URL. Batch them.');
  });

  it('leaves other tools alone', () => {
    const p = policyWith({ overrides: { fetch_url: { description: 'New.' } } });
    expect(describeWithPolicy(p, 'web_search', 'Search.')).toBe('Search.');
  });
});

describe('tool policy: visibility promotion is additive only', () => {
  it('reports a promoted tool', () => {
    const p = policyWith({ promoteToEssential: ['ha_query_state'] });
    expect(isPromoted(p, 'ha_query_state')).toBe(true);
    expect(isPromoted(p, 'fetch_url')).toBe(false);
  });

  it('has no representation for demotion — the field only adds names', () => {
    const p = policyWith({ promoteToEssential: [] });
    expect(Object.keys(p)).not.toContain('demoteFromEssential');
  });
});

describe('tool policy: global guidance rendering', () => {
  it('renders nothing when there is no guidance', () => {
    expect(renderGlobalGuidance(emptyPolicy())).toBe('');
  });

  it('joins rules into one appendable sentence', () => {
    const p = policyWith({ globalGuidance: ['Never loop a tool.', 'Reuse earlier results.'] });
    expect(renderGlobalGuidance(p)).toBe(
      ' Call-efficiency rules: Never loop a tool. Reuse earlier results.',
    );
  });
});
