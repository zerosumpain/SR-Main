import { describe, it, expect } from 'vitest';
import {
  claimsBatching,
  clip,
  duplicateShare,
  registryName,
  schemaSupportsBatching,
  unknownToolsNamed,
  validateOverride,
} from './optimise';

describe('resolving a pattern back to a registry tool', () => {
  it('strips the jkai_extended display prefix', () => {
    expect(registryName('jkai:fetch_url')).toBe('fetch_url');
  });
  it('leaves a directly-called tool name alone', () => {
    expect(registryName('api_call')).toBe('api_call');
  });
});

describe('detecting whether a tool can actually batch', () => {
  it('finds an array parameter', () => {
    expect(
      schemaSupportsBatching({ type: 'object', properties: { urls: { type: 'array' } } }),
    ).toBe(true);
  });
  it('finds a union that includes array', () => {
    expect(
      schemaSupportsBatching({ type: 'object', properties: { url: { type: ['string', 'array'] } } }),
    ).toBe(true);
  });
  it('rejects a single-value schema', () => {
    expect(
      schemaSupportsBatching({ type: 'object', properties: { url: { type: 'string' } } }),
    ).toBe(false);
  });
  it('rejects malformed or absent schemas rather than assuming', () => {
    expect(schemaSupportsBatching(null)).toBe(false);
    expect(schemaSupportsBatching({})).toBe(false);
    expect(schemaSupportsBatching('nonsense')).toBe(false);
  });
});

describe('overlay validation — the guard against promising what the schema cannot do', () => {
  const singleValue = { type: 'object', properties: { url: { type: 'string' } } };
  const batchable = { type: 'object', properties: { urls: { type: 'array' } } };

  it('rejects an overlay telling the caller to pass an array to a single-value tool', () => {
    const r = validateOverride(
      { description: 'Fetch pages. Accepts an array of URLs.' },
      singleValue,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no parameter accepts an array/);
  });

  it('rejects the same claim phrased as "all in one call"', () => {
    expect(validateOverride({ guidance: 'Pass all URLs in one call.' }, singleValue).ok).toBe(false);
  });

  it('rejects "batch" phrasing', () => {
    expect(validateOverride({ guidance: 'Batch your requests.' }, singleValue).ok).toBe(false);
  });

  it('allows the batching claim when the schema genuinely supports it', () => {
    expect(validateOverride({ guidance: 'Pass an array of URLs.' }, batchable).ok).toBe(true);
  });

  it('allows non-batching advice on a single-value tool', () => {
    const r = validateOverride(
      { guidance: 'Repeating this with near-identical arguments returns the same data.' },
      singleValue,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects an empty overlay', () => {
    expect(validateOverride({}, batchable).ok).toBe(false);
    expect(validateOverride({ description: '   ' }, batchable).ok).toBe(false);
  });
});

describe('duplicate share', () => {
  it('is the fraction of repeats that were byte-identical', () => {
    expect(duplicateShare({ repeatCalls: 151, duplicateCalls: 1 })).toBeCloseTo(0.0066, 3);
    expect(duplicateShare({ repeatCalls: 10, duplicateCalls: 5 })).toBe(0.5);
  });
  it('is zero when there are no repeats at all', () => {
    expect(duplicateShare({ repeatCalls: 0, duplicateCalls: 0 })).toBe(0);
  });
});

describe('rejecting redundancy advice aimed at distinct calls', () => {
  const singleValue = { type: 'object', properties: { url: { type: 'string' } } };
  // The real fetch_url pattern: 151 repeats, 1 identical.
  const mostlyDistinct = { repeatCalls: 151, duplicateCalls: 1 };
  const mostlyIdentical = { repeatCalls: 20, duplicateCalls: 14 };

  it('rejects the exact overlay the first live run produced', () => {
    const r = validateOverride(
      {
        description:
          'Fetch a public web URL. Important: calling this tool with the same URL more than once in the same turn returns identical content. Do not make redundant calls; use the result from the first fetch if you have already retrieved that URL.',
        guidance: 'If you have already fetched a URL earlier in this turn, do not fetch it again.',
      },
      singleValue,
      { pattern: mostlyDistinct, siblingNames: ['research_web_search'] },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/1 of 151 repeats were identical/);
  });

  it('allows redundancy advice when the repeats REALLY are identical', () => {
    const r = validateOverride(
      { guidance: 'Calling this again with the same arguments returns identical data.' },
      singleValue,
      { pattern: mostlyIdentical, siblingNames: [] },
    );
    expect(r.ok).toBe(true);
  });

  it('allows it when the overlay also names a sibling tool that collapses the calls', () => {
    const r = validateOverride(
      {
        guidance:
          'Do not call this again for the same entity; to read several entities use ha_render_template once.',
      },
      singleValue,
      { pattern: mostlyDistinct, siblingNames: ['ha_render_template', 'ha_call_service'] },
    );
    expect(r.ok).toBe(true);
  });

  it('allows it when the overlay points at consolidating onto one call', () => {
    const r = validateOverride(
      {
        guidance:
          'Prefer fetching a single index page that links everything, rather than one call per URL.',
      },
      singleValue,
      { pattern: mostlyDistinct, siblingNames: [] },
    );
    expect(r.ok).toBe(true);
  });

  it('stays out of the way when no pattern is supplied', () => {
    const r = validateOverride({ guidance: 'Do not fetch the same URL again.' }, singleValue);
    expect(r.ok).toBe(true);
  });
});

describe('clip — ledger text is trimmed on a word boundary', () => {
  it('leaves short text alone', () => {
    expect(clip('short enough', 40)).toBe('short enough');
  });
  it('never cuts mid-word (the "drastical" bug)', () => {
    const out = clip('Fetching that page first reveals which links are worth following, drastically fewer calls', 78);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/drastical…$/);
    expect(out).toContain('following');
  });
  it('drops trailing punctuation before the ellipsis', () => {
    expect(clip('one two three four five', 13)).toBe('one two three…');
  });
  it('falls back to a hard cut when there is no early space', () => {
    expect(clip('a'.repeat(50), 10)).toBe('aaaaaaaaaa…');
  });
});

describe('claimsBatching — only fires on THIS tool taking many values', () => {
  const sibs = ['ha_render_template', 'research_web_search'];

  it('catches an explicit array instruction', () => {
    expect(claimsBatching('accepts an array of urls', sibs)).toBe(true);
    expect(claimsBatching('pass a list of entity ids', sibs)).toBe(true);
    expect(claimsBatching('provide multiple urls in the argument', sibs)).toBe(true);
  });

  it('does NOT fire when a single call to a SIBLING covers everything', () => {
    expect(
      claimsBatching('to read several entities, use ha_render_template once instead', sibs),
    ).toBe(false);
  });

  it('does NOT fire on the prompt\'s own "one well-chosen call" phrasing', () => {
    expect(
      claimsBatching('fetch the index page once; it lists all the links you need', sibs),
    ).toBe(false);
    expect(claimsBatching('one call can answer the whole question', sibs)).toBe(false);
  });

  it('scopes per sentence — a safe sentence does not excuse an unsafe one', () => {
    expect(
      claimsBatching('fetch the index page first. also pass an array of urls', sibs),
    ).toBe(true);
  });
});

describe('validateOverride accepts the sibling-consolidation advice we actually want', () => {
  const singleValue = { type: 'object', properties: { entity_id: { type: 'string' } } };
  it('allows "use ha_render_template once" on a single-value tool', () => {
    const r = validateOverride(
      { guidance: 'To read several entities, call ha_render_template once with a template covering them.' },
      singleValue,
      { pattern: { repeatCalls: 43, duplicateCalls: 2 }, siblingNames: ['ha_render_template'] },
    );
    expect(r.ok).toBe(true);
  });
  it('still rejects a genuine array promise', () => {
    const r = validateOverride(
      { guidance: 'Pass an array of entity_ids to fetch them together.' },
      singleValue,
      { pattern: { repeatCalls: 43, duplicateCalls: 2 }, siblingNames: ['ha_render_template'] },
    );
    expect(r.ok).toBe(false);
  });
});

describe('unknownToolsNamed — catching an invented tool', () => {
  const known = new Set(['fetch_url', 'research_web_search', 'ha_render_template']);

  it('catches the exact hallucination the first trial runs produced', () => {
    expect(unknownToolsNamed("check whether the sibling tool 'search_web' can help", known, ['url']))
      .toEqual(['search_web']);
  });

  it('passes a real tool through', () => {
    expect(unknownToolsNamed('use research_web_search instead', known, ['url'])).toEqual([]);
  });

  it("does not flag this tool's own parameters", () => {
    expect(unknownToolsNamed('pass the entity_id you care about', known, ['entity_id'])).toEqual([]);
  });

  it('ignores ordinary prose', () => {
    expect(unknownToolsNamed('fetch the page once and reuse it', known, ['url'])).toEqual([]);
  });
});

describe('validateOverride rejects overlays naming tools that do not exist', () => {
  const singleValue = { type: 'object', properties: { url: { type: 'string' } } };
  it('rejects search_web', () => {
    const r = validateOverride(
      { guidance: "First check whether the sibling tool 'search_web' can answer it in a single query." },
      singleValue,
      {
        pattern: { repeatCalls: 151, duplicateCalls: 1 },
        siblingNames: ['research_web_search'],
        knownTools: new Set(['fetch_url', 'research_web_search']),
        schemaParams: ['url'],
      },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/do not exist: search_web/);
  });
  it('accepts the same advice naming the real tool', () => {
    const r = validateOverride(
      { guidance: 'First check whether research_web_search can answer it in a single query.' },
      singleValue,
      {
        pattern: { repeatCalls: 151, duplicateCalls: 1 },
        siblingNames: ['research_web_search'],
        knownTools: new Set(['fetch_url', 'research_web_search']),
        schemaParams: ['url'],
      },
    );
    expect(r.ok).toBe(true);
  });
});
