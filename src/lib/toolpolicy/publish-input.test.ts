import { describe, it, expect } from 'vitest';
import { coerceOwnerPublish, needsHermesReconnect, MAX_PROMOTIONS } from './publish-input';
import { ESSENTIAL_TOOL_NAMES } from '$lib/mcp/essentials';

const registered = new Set(['ha_render_template', 'ha_query_state', 'workflow_inspect', 'build_inspect', 'gmail_search', 'gmail_get_message', 'blog_list']);

describe('owner-authored policy publish', () => {
  it('accepts a promotion set and marks it owner-authored', () => {
    const r = coerceOwnerPublish(
      { rationale: 'Trial promoting the four most-invoked extended tools.', promoteToEssential: ['ha_render_template', 'ha_query_state'] },
      registered,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.createdBy).toBe('owner');
    expect(r.input.promoteToEssential).toEqual(['ha_render_template', 'ha_query_state']);
  });

  it('rejects a name the registry does not know, rather than dropping it', () => {
    // A promoted name that does not resolve costs manifest tokens on every
    // turn forever and surfaces nothing — silence here is the expensive bug.
    const r = coerceOwnerPublish({ rationale: 'x', promoteToEssential: ['ha_query_state', 'search_web'] }, registered);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('search_web') });
  });

  it('rejects promoting something already hardcoded as essential', () => {
    const alreadyEssential = [...ESSENTIAL_TOOL_NAMES][0];
    const r = coerceOwnerPublish(
      { rationale: 'x', promoteToEssential: [alreadyEssential] },
      new Set([...registered, alreadyEssential]),
    );
    // A version that quietly does nothing is worse than an error: it burns the
    // single trial slot proving nothing.
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('no-op') });
  });

  it('deduplicates and caps the promotion set', () => {
    const dup = coerceOwnerPublish({ rationale: 'x', promoteToEssential: ['gmail_search', 'gmail_search'] }, registered);
    expect(dup.ok && dup.input.promoteToEssential).toEqual(['gmail_search']);

    const many = Array.from({ length: MAX_PROMOTIONS + 1 }, (_, i) => `tool_${i}`);
    const over = coerceOwnerPublish({ rationale: 'x', promoteToEssential: many }, new Set(many));
    expect(over).toMatchObject({ ok: false, error: expect.stringContaining(`At most ${MAX_PROMOTIONS}`) });
  });

  it('requires a rationale, because the ledger and the next run both read it', () => {
    expect(coerceOwnerPublish({ promoteToEssential: ['gmail_search'] }, registered)).toMatchObject({ ok: false, error: expect.stringContaining('rationale') });
    expect(coerceOwnerPublish({ rationale: '   ', promoteToEssential: ['gmail_search'] }, registered)).toMatchObject({ ok: false, error: expect.stringContaining('rationale') });
  });

  it('refuses a version that would change nothing', () => {
    expect(coerceOwnerPublish({ rationale: 'well meant' }, registered)).toMatchObject({ ok: false, error: expect.stringContaining('Nothing to publish') });
  });

  it('strips anything that is not a description-shaped hint from an override', () => {
    const r = coerceOwnerPublish(
      { rationale: 'x', overrides: { blog_list: { description: 'Better.', handler: 'evil()', parameters: { hacked: true } } } },
      registered,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // This is what makes the overlay structurally incapable of changing
    // behaviour — the keys are lost here, not later.
    expect(r.input.overrides!.blog_list).toEqual({ description: 'Better.' });
  });

  it('rejects an override aimed at a tool that does not exist', () => {
    const r = coerceOwnerPublish({ rationale: 'x', overrides: { nope_tool: { guidance: 'hi' } } }, registered);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('nope_tool') });
  });

  it('rejects a non-array promotion set outright', () => {
    expect(coerceOwnerPublish({ rationale: 'x', promoteToEssential: 'gmail_search' }, registered))
      .toMatchObject({ ok: false, error: expect.stringContaining('must be an array') });
  });
});

describe('which changes need the gateway to reconnect', () => {
  it('flags promotions and global guidance, which live only in the manifest', () => {
    expect(needsHermesReconnect({ promoteToEssential: ['gmail_search'], globalGuidance: [] })).toBe(true);
    expect(needsHermesReconnect({ promoteToEssential: [], globalGuidance: ['never loop'] })).toBe(true);
  });

  it('does not flag a plain description override, which is applied per call', () => {
    // `dispatchMetaTool` runs `describeWithPolicy` on every list/schema, so an
    // extended tool's rewritten description is live without a restart.
    expect(needsHermesReconnect({ promoteToEssential: [], globalGuidance: [] })).toBe(false);
  });
});
