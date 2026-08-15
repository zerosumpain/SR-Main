import { describe, it, expect } from 'vitest';
import {
  GROUNDING_MODES,
  GROUNDING_OPTIONS,
  coerceGrounding,
  groundingOption,
  isGrounded,
  isRedirectCitation,
  readCitations,
} from './grounding';

describe('coerceGrounding', () => {
  it('accepts the three modes', () => {
    for (const m of GROUNDING_MODES) expect(coerceGrounding(m)).toBe(m);
  });

  it('falls back to off for anything else, so a bad value never silently spends', () => {
    for (const v of ['live', 'cached', 'on', '', null, undefined, 3, {}]) {
      expect(coerceGrounding(v)).toBe('off');
    }
  });
});

describe('the options', () => {
  it('has one entry per mode, and groundingOption finds each', () => {
    expect(GROUNDING_OPTIONS.map((o) => o.mode)).toEqual([...GROUNDING_MODES]);
    for (const m of GROUNDING_MODES) expect(groundingOption(m).mode).toBe(m);
  });

  it('states that only the searching routes can cite', () => {
    expect(groundingOption('off').cites).toBe(false);
    expect(groundingOption('fast').cites).toBe(true);
    expect(groundingOption('free').cites).toBe(true);
  });

  it('prices the subscription route at zero cash and the others above it', () => {
    expect(groundingOption('free').costUsd).toBe(0);
    expect(groundingOption('fast').costUsd).toBeGreaterThan(groundingOption('off').costUsd);
  });

  it('orders the routes by how long they take, which is the trade being made', () => {
    const s = GROUNDING_OPTIONS.map((o) => o.seconds);
    expect(s).toEqual([...s].sort((a, b) => a - b));
  });

  it('falls back to the no-search option for an unknown mode', () => {
    expect(groundingOption('nonsense' as never).mode).toBe('off');
  });
});

describe('isGrounded', () => {
  it('is true for exactly the routes that reach the web', () => {
    expect(isGrounded('off')).toBe(false);
    expect(isGrounded('fast')).toBe(true);
    expect(isGrounded('free')).toBe(true);
  });
});

describe('readCitations', () => {
  it('reads the OpenAI-shaped annotation both providers emit', () => {
    expect(
      readCitations({
        annotations: [
          { type: 'url_citation', url_citation: { url: 'https://nodejs.org/x', title: 'nodejs.org' } },
          { type: 'url_citation', url_citation: { url: 'https://a.test/p' } },
        ],
      }),
    ).toEqual([
      { url: 'https://nodejs.org/x', title: 'nodejs.org' },
      { url: 'https://a.test/p', title: null },
    ]);
  });

  it('survives a message with no annotations at all', () => {
    expect(readCitations({ content: 'hello' })).toEqual([]);
    expect(readCitations({ annotations: null })).toEqual([]);
    expect(readCitations(null)).toEqual([]);
    expect(readCitations(undefined)).toEqual([]);
  });

  /**
   * The field is absent from the OpenAI SDK's types on both paths, so it is
   * whatever the provider felt like sending. A malformed entry must not take
   * the good ones with it.
   */
  it('skips malformed entries rather than throwing', () => {
    expect(
      readCitations({
        annotations: [
          { type: 'url_citation' },
          { url_citation: { url: 42 } },
          { url_citation: { url: '   ' } },
          'not an object',
          null,
          { url_citation: { url: 'https://good.test/p' } },
        ],
      }),
    ).toEqual([{ url: 'https://good.test/p', title: null }]);
  });

  it('refuses a non-http citation, so nothing javascript: shaped reaches a link', () => {
    expect(
      readCitations({ annotations: [{ url_citation: { url: 'javascript:alert(1)' } }] }),
    ).toEqual([]);
    expect(readCitations({ annotations: [{ url_citation: { url: 'ftp://x.test/f' } }] })).toEqual([]);
  });
});

describe('isRedirectCitation', () => {
  it('spots the Google grounding redirect that must be resolved before storing', () => {
    expect(
      isRedirectCitation('https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ'),
    ).toBe(true);
  });

  it('leaves an ordinary citation alone', () => {
    expect(isRedirectCitation('https://nodejs.org/en/blog/release/v26.7.0/')).toBe(false);
    expect(isRedirectCitation('not a url')).toBe(false);
  });

  /** Host-suffix matching, not a substring test — the trap that once classified
   *  `ir.huronconsultinggroup.com` as a peer-reviewed paper. */
  it('is not fooled by a lookalike host', () => {
    expect(isRedirectCitation('https://evil-vertexaisearch.cloud.google.com.attacker.test/x')).toBe(
      false,
    );
  });
});
