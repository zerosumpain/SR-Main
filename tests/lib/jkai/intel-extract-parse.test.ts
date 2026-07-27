import { describe, it, expect } from 'vitest';
import { parseExtractionJson } from '$lib/jkai/intel/extract';

// The extractor's output parse used to be
//   raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
// which strips a fence and LEAVES anything in front of it. So any turn where the
// model prefixed a sentence produced prose-then-object, JSON.parse threw, and
// the caller swallowed it into an empty extraction — the note was marked
// processed and the thread silently learned nothing. Measured at 2 of 6
// extractions in production on 2026-07-27.
describe('parseExtractionJson', () => {
  const body = {
    summary: 'A summary.',
    entities: [{ name: 'OpenSAFELY', type: 'system', confidence: 'high', properties: {}, possibleMatchId: null }],
    relationships: [],
    timelineEvents: [],
    proposedNewTypes: [],
  };

  it('parses a bare JSON object', () => {
    expect(parseExtractionJson(JSON.stringify(body))?.entities[0].name).toBe('OpenSAFELY');
  });

  it('parses a fenced block', () => {
    const raw = '```json\n' + JSON.stringify(body) + '\n```';
    expect(parseExtractionJson(raw)?.entities[0].name).toBe('OpenSAFELY');
  });

  it('parses despite a preamble before the fence — the production failure', () => {
    const raw = 'Here is the JSON:\n```json\n' + JSON.stringify(body) + '\n```';
    expect(parseExtractionJson(raw)?.entities[0].name).toBe('OpenSAFELY');
  });

  it('parses despite a preamble with no fence at all', () => {
    const raw = 'Sure! Here is the extraction:\n' + JSON.stringify(body);
    expect(parseExtractionJson(raw)?.entities[0].name).toBe('OpenSAFELY');
  });

  it('parses despite trailing commentary', () => {
    const raw = JSON.stringify(body) + '\n\nLet me know if you need more detail.';
    expect(parseExtractionJson(raw)?.entities[0].name).toBe('OpenSAFELY');
  });

  it('defaults every collection so a partial object is still usable', () => {
    const parsed = parseExtractionJson('{"summary":"only a summary"}');
    expect(parsed).toEqual({
      summary: 'only a summary',
      entities: [],
      relationships: [],
      timelineEvents: [],
      proposedNewTypes: [],
    });
  });

  it('returns null for genuinely unparseable output, rather than an empty result', () => {
    // Null is what lets the caller retry and then fail loudly. Returning an
    // empty ExtractionResult here is the original bug.
    expect(parseExtractionJson('I could not complete that request.')).toBeNull();
    expect(parseExtractionJson('')).toBeNull();
  });

  it('rejects a valid-JSON scalar — valid JSON is not a valid extraction', () => {
    expect(parseExtractionJson('42')).toBeNull();
    expect(parseExtractionJson('[1,2,3]')).toBeNull();
  });

  it('recovers the object when the model wraps it in both prose and a fence with trailing text', () => {
    const raw = `Certainly.\n\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\`\n\nThat covers the note.`;
    expect(parseExtractionJson(raw)?.entities[0].name).toBe('OpenSAFELY');
  });
});
