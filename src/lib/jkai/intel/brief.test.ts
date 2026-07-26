import { describe, it, expect } from 'vitest';
import {
  buildBriefPrompt,
  extractCitationMarkers,
  reconcileCitations,
  formatBriefDocument,
  MAX_EXCERPT_CHARS,
  type BriefContext,
  type BriefSource,
  type BriefSubject,
  type BriefNeighbour,
} from './brief';

function subject(over: Partial<BriefSubject> = {}): BriefSubject {
  return {
    id: 'e1',
    name: 'Department for Education',
    typeName: 'organisation',
    icon: '🏛',
    summary: 'The department responsible for education in England.',
    confirmed: true,
    aliases: ['DfE'],
    degree: 3,
    noteCount: 4,
    sourceGrade: 'B',
    credibility: 2,
    corroboration: 3,
    confidenceScore: 0.72,
    ...over,
  };
}

function neighbour(over: Partial<BriefNeighbour> = {}): BriefNeighbour {
  return {
    id: 'e2',
    name: 'Ofsted',
    typeName: 'organisation',
    viaId: 'e1',
    relationship: 'inspects for',
    degree: 5,
    crossCommunity: true,
    ...over,
  };
}

function source(n: number, over: Partial<BriefSource> = {}): BriefSource {
  return {
    n,
    noteId: `note-${n}`,
    title: `Note ${n}`,
    source: 'web',
    createdAt: '2026-07-01T09:00:00.000Z',
    excerpt: `Excerpt for note ${n}.`,
    href: `/jkai/intel/notes/note-${n}`,
    sourceUrl: null,
    entityIds: ['e1'],
    ...over,
  };
}

function context(over: Partial<BriefContext> = {}): BriefContext {
  return {
    title: 'Department for Education',
    subjects: [subject()],
    neighbours: [neighbour()],
    links: [],
    sources: [source(1), source(2)],
    timeline: [],
    research: [],
    openQuestions: [],
    generatedAt: '2026-07-26T12:00:00.000Z',
    ...over,
  };
}

describe('buildBriefPrompt — the subject', () => {
  it('names the entity and its type', () => {
    const { user } = buildBriefPrompt(context());
    expect(user).toContain('Department for Education');
    expect(user).toContain('organisation');
  });

  it('carries aliases so the model recognises the short form in excerpts', () => {
    expect(buildBriefPrompt(context()).user).toContain('DfE');
  });

  it('states trust rather than leaving it implied', () => {
    const { user } = buildBriefPrompt(context());
    expect(user).toContain('source grade B');
    expect(user).toContain('credibility 2');
    expect(user).toContain('corroborated by 3 independent sources');
    expect(user).toContain('analyst-confirmed');
  });

  it('flags an unconfirmed subject explicitly', () => {
    const { user } = buildBriefPrompt(context({ subjects: [subject({ confirmed: false })] }));
    expect(user).toContain('NOT analyst-confirmed');
  });

  it('omits ungraded trust fields instead of printing nulls', () => {
    const { user } = buildBriefPrompt(
      context({
        subjects: [subject({ sourceGrade: null, credibility: null, confidenceScore: null })],
      }),
    );
    expect(user).not.toContain('source grade');
    expect(user).not.toContain('null');
  });

  it('lists every subject of a multi-entity brief', () => {
    const { user } = buildBriefPrompt(
      context({
        title: 'Schools accountability',
        subjects: [subject(), subject({ id: 'e9', name: 'Ofqual', aliases: [] })],
      }),
    );
    expect(user).toContain('Department for Education');
    expect(user).toContain('Ofqual');
    expect(user).toContain('BRIEF: Schools accountability');
  });
});

describe('buildBriefPrompt — connections', () => {
  it('names each neighbour with the relationship and the subject it hangs off', () => {
    const { user } = buildBriefPrompt(context());
    expect(user).toContain('Ofsted');
    expect(user).toContain('inspects for');
    expect(user).toContain('Department for Education —[inspects for]→ Ofsted');
  });

  it('marks a neighbour in another cluster', () => {
    expect(buildBriefPrompt(context()).user).toContain('different cluster');
  });

  it('says plainly when there are no connections', () => {
    const { user } = buildBriefPrompt(context({ neighbours: [] }));
    expect(user).toContain('No connections recorded in the graph.');
  });

  it('renders subject-to-subject links when the case file holds both ends', () => {
    const { user } = buildBriefPrompt(
      context({
        links: [
          { fromId: 'e1', toId: 'e9', fromName: 'DfE', toName: 'Ofqual', relationship: 'sponsors' },
        ],
      }),
    );
    expect(user).toContain('LINKS BETWEEN SUBJECTS');
    expect(user).toContain('DfE —[sponsors]→ Ofqual');
  });
});

describe('buildBriefPrompt — citations', () => {
  it('numbers the sources so the model has markers to cite', () => {
    const { user } = buildBriefPrompt(context());
    expect(user).toContain('[1] Note 1');
    expect(user).toContain('[2] Note 2');
  });

  it('includes the excerpt each claim was made in', () => {
    expect(buildBriefPrompt(context()).user).toContain('Excerpt for note 1.');
  });

  it('truncates a runaway excerpt rather than shipping the whole note', () => {
    const long = 'x'.repeat(MAX_EXCERPT_CHARS + 500);
    const { user } = buildBriefPrompt(context({ sources: [source(1, { excerpt: long })] }));
    expect(user).not.toContain(long);
    expect(user).toContain('…');
  });

  it('requires a marker on every factual sentence', () => {
    expect(buildBriefPrompt(context()).system).toContain('citation marker');
  });

  it('forbids inventing a source number', () => {
    expect(buildBriefPrompt(context()).system).toContain('Never invent a source number');
  });
});

describe('buildBriefPrompt — degradation', () => {
  it('states there is no evidence rather than leaving the section empty', () => {
    const { user, system } = buildBriefPrompt(context({ sources: [] }));
    expect(user).toContain('NO SOURCES');
    expect(system).toContain('THIS BRIEF HAS NO SOURCES');
    expect(system).toContain('no citation markers');
  });

  it('keeps the normal system prompt once there is any evidence', () => {
    expect(buildBriefPrompt(context()).system).not.toContain('THIS BRIEF HAS NO SOURCES');
  });

  it('survives an entirely empty graph neighbourhood', () => {
    const bare = context({ neighbours: [], sources: [], timeline: [], links: [], research: [] });
    const { user } = buildBriefPrompt(bare);
    expect(user).toContain('Department for Education');
    expect(user).toContain('No connections recorded');
    expect(user).toContain('No dated events recorded.');
  });

  it('tells the model to stop when nothing resolved', () => {
    const { user } = buildBriefPrompt(context({ subjects: [], neighbours: [], sources: [] }));
    expect(user).toContain('No subject resolved');
  });

  it('is deterministic — the same context yields the same prompt', () => {
    const c = context();
    expect(buildBriefPrompt(c)).toEqual(buildBriefPrompt(c));
  });
});

describe('buildBriefPrompt — timeline and questions', () => {
  it('attaches the citation number to a dated event', () => {
    const { user } = buildBriefPrompt(
      context({
        timeline: [
          {
            date: '2026-03-01',
            dateEnd: null,
            title: 'Funding review published',
            description: null,
            entityName: 'Department for Education',
            citation: 2,
          },
        ],
      }),
    );
    expect(user).toContain('2026-03-01: Funding review published');
    expect(user).toContain('[2]');
  });

  it('asks the brief to answer the analyst’s open questions', () => {
    const { user } = buildBriefPrompt(context({ openQuestions: ['Who signs off the budget?'] }));
    expect(user).toContain('OPEN QUESTIONS');
    expect(user).toContain('Who signs off the budget?');
  });

  it('lists research already commissioned so it is not recommended again', () => {
    const { user } = buildBriefPrompt(
      context({
        research: [
          {
            id: 'r1',
            topic: 'DfE funding settlement',
            status: 'running',
            url: '/deepdive/r1',
            createdAt: '2026-07-20T09:00:00.000Z',
          },
        ],
      }),
    );
    expect(user).toContain('COMMISSIONED RESEARCH');
    expect(user).toContain('DfE funding settlement');
  });
});

describe('extractCitationMarkers', () => {
  it('finds single markers in order of use', () => {
    expect(extractCitationMarkers('Alpha [2]. Beta [1].')).toEqual([2, 1]);
  });

  it('splits a comma list inside one bracket', () => {
    expect(extractCitationMarkers('Claim [1, 3].')).toEqual([1, 3]);
  });

  it('reads adjacent markers separately', () => {
    expect(extractCitationMarkers('Claim [1][4].')).toEqual([1, 4]);
  });

  it('ignores bracketed text that is not a number', () => {
    expect(extractCitationMarkers('See [note] and [1].')).toEqual([1]);
  });

  it('returns nothing for uncited prose', () => {
    expect(extractCitationMarkers('No markers at all.')).toEqual([]);
  });
});

describe('reconcileCitations', () => {
  const sources = [source(1), source(2)];

  it('keeps markers that point at a real source', () => {
    const out = reconcileCitations('The department was reorganised [1].', sources);
    expect(out.markdown).toContain('[1]');
    expect(out.droppedMarkers).toEqual([]);
  });

  it('strips an invented marker out of the prose', () => {
    const out = reconcileCitations('A confident but unsourced claim [7].', sources);
    expect(out.markdown).not.toContain('[7]');
    expect(out.markdown).toContain('unsourced claim.');
    expect(out.droppedMarkers).toEqual([7]);
  });

  it('keeps the valid half of a mixed marker', () => {
    const out = reconcileCitations('Partly sourced [1, 9].', sources);
    expect(out.markdown).toContain('[1]');
    expect(out.markdown).not.toContain('[9]');
    expect(out.droppedMarkers).toEqual([9]);
  });

  it('reports which sources the brief actually leant on', () => {
    const out = reconcileCitations('Only the first [1].', sources);
    expect(out.citations.map((c) => [c.n, c.used])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('maps every citation back to a real note id', () => {
    const out = reconcileCitations('Cited [2].', sources);
    const cited = out.citations.find((c) => c.used);
    expect(cited?.noteId).toBe('note-2');
    expect(cited?.href).toBe('/jkai/intel/notes/note-2');
  });

  it('drops every marker when the brief had no sources', () => {
    const out = reconcileCitations('Unsupported [1] and [2].', []);
    expect(out.markdown).not.toMatch(/\[\d+\]/);
    expect(out.droppedMarkers).toEqual([1, 2]);
    expect(out.citations).toEqual([]);
  });

  it('leaves prose untouched when nothing is cited', () => {
    expect(reconcileCitations('Plain prose.', sources).markdown).toBe('Plain prose.');
  });
});

describe('formatBriefDocument', () => {
  const ctx = context();
  const { citations } = reconcileCitations('Body [1].', ctx.sources);

  it('leads with the brief title', () => {
    expect(formatBriefDocument('Body [1].', ctx, citations)).toContain('# Department for Education');
  });

  it('records what the brief was built from', () => {
    const doc = formatBriefDocument('Body [1].', ctx, citations);
    expect(doc).toContain('2 sources');
    expect(doc).toContain('1 graph connection');
  });

  it('appends a numbered source list so the file stands alone', () => {
    const doc = formatBriefDocument('Body [1].', ctx, citations);
    expect(doc).toContain('## Sources');
    expect(doc).toContain('1. Note 1 — web, 2026-07-01 — /jkai/intel/notes/note-1');
  });

  it('shows the external URL alongside the graph copy when there is one', () => {
    const withUrl = context({ sources: [source(1, { sourceUrl: 'https://example.org/a' })] });
    const doc = formatBriefDocument('Body [1].', withUrl, reconcileCitations('Body [1].', withUrl.sources).citations);
    expect(doc).toContain('https://example.org/a');
  });

  it('omits the source list entirely for an unsourced brief', () => {
    const bare = context({ sources: [] });
    expect(formatBriefDocument('Body.', bare, [])).not.toContain('## Sources');
  });
});
