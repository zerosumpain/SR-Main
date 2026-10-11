import { describe, expect, it } from 'vitest';
import type { ProjectCard, ProjectEntry } from '$lib/projects/views';
import { benchLine, benchSentence, bridgeLine, entryNumber, handHeading, splitTitle, type Seg } from './sentence';

const say = (segs: Seg[]) => segs.map((s) => (s.t === 'text' ? s.s : s.word + (s.t === 'fig' ? (s.end ?? '') : ''))).join('');
const figs = (segs: Seg[]) => segs.flatMap((s) => (s.t === 'fig' ? [`${s.n}:${s.id}`] : []));
const counts = (studies: number, games: number, tools: number, agent: number) => ({
  bench: studies + games + tools + agent,
  studies,
  games,
  tools,
  agent,
});

describe('benchSentence', () => {
  it('reads the whole bench, hand and agent', () => {
    const s = benchSentence(counts(6, 3, 4, 2));
    expect(say(s)).toBe(
      'There are 15 things on the bench: six field studies, three games and four tools I made by hand, and two an agent wrote from a single prompt.',
    );
    expect(figs(s)).toEqual(['1:study', '2:game', '3:tool', '4:agent']);
    // The comma after a figure is set before its numeral.
    expect(s.find((x) => x.t === 'fig' && x.id === 'study')).toMatchObject({ end: ',' });
  });

  it('drops a family with nothing in it rather than say "no games"', () => {
    const s = benchSentence(counts(6, 0, 4, 1));
    expect(say(s)).toBe(
      'There are eleven things on the bench: six field studies and four tools I made by hand, and one an agent wrote from a single prompt.',
    );
    expect(say(s)).not.toMatch(/\bno\b/);
    expect(figs(s)).toEqual(['1:study', '2:tool', '3:agent']);
  });

  it('says how when nothing came from the agent', () => {
    expect(say(benchSentence(counts(1, 1, 0, 0)))).toBe(
      'There are two things on the bench: one field study and one game, both made by hand.',
    );
    expect(say(benchSentence(counts(6, 3, 4, 0)))).toBe(
      'There are 13 things on the bench: six field studies, three games and four tools, all made by hand.',
    );
  });

  it('lets one kind of thing be the total', () => {
    expect(say(benchSentence(counts(0, 3, 0, 0)))).toBe('There are three games on the bench, all made by hand.');
    expect(say(benchSentence(counts(1, 0, 0, 0)))).toBe('There is one field study on the bench, made by hand.');
    const agentOnly = benchSentence(counts(0, 0, 0, 2));
    expect(say(agentOnly)).toBe('There are two things on the bench, both written by an agent from a single prompt.');
    expect(figs(agentOnly)).toEqual(['1:agent']);
    expect(say(benchSentence(counts(0, 0, 0, 1)))).toBe(
      'There is one thing on the bench, written by an agent from a single prompt.',
    );
  });

  it('keeps one family alongside the agent in the long form', () => {
    expect(say(benchSentence(counts(0, 0, 1, 1)))).toBe(
      'There are two things on the bench: one tool I made by hand, and one an agent wrote from a single prompt.',
    );
  });

  it('has nothing to count on an empty bench', () => {
    expect(say(benchSentence(counts(0, 0, 0, 0)))).toBe('There is nothing on the bench just now.');
  });
});

describe('bridgeLine', () => {
  it('counts the chapters', () => {
    expect(bridgeLine(15, 2)).toBe('That’s the short version. The long one takes two chapters, a paragraph to each project.');
    expect(bridgeLine(1, 1)).toBe('That’s the short version. The long one takes one chapter, a paragraph to each thing.');
    expect(bridgeLine(0, 1)).toMatch(/whole of it/);
  });
});

describe('handHeading', () => {
  const e = (...f: Array<'study' | 'game' | 'tool'>) => f.map((family) => ({ family }));
  it('names the families present', () => {
    expect(handHeading(e('study', 'game', 'tool', 'study'))).toBe('The field studies, games & tools');
    expect(handHeading(e('tool', 'study'))).toBe('The field studies & tools');
    expect(handHeading(e('game', 'game'))).toBe('The games');
    expect(handHeading([])).toBe('Made by hand');
  });
});

describe('splitTitle', () => {
  it('splits a name from its dek', () => {
    expect(splitTitle('Marbler — a marble race built on luck')).toEqual({ name: 'Marbler', dek: 'a marble race built on luck' });
    expect(splitTitle('An allotment ledger: what was sown, when')).toEqual({ name: 'An allotment ledger', dek: 'what was sown, when' });
    expect(splitTitle('Hex')).toEqual({ name: 'Hex', dek: null });
    expect(splitTitle('Data Standard Designer — Design & Publish a Dataset Standard').name).toBe('Data Standard Designer');
  });
});

describe('entryNumber and benchLine', () => {
  it('sets two figures', () => {
    expect(entryNumber(3)).toBe('03');
    expect(entryNumber(15)).toBe('15');
  });
  it('beats once per project, in order', () => {
    const l = benchLine(['hand', 'hand', 'agent']);
    expect(l.beats.map((b) => b.section)).toEqual(['hand', 'hand', 'agent']);
    expect(l.beats.every((b) => b.d.startsWith('M'))).toBe(true);
    expect(benchLine([]).beats).toEqual([]);
  });
});

describe('SentenceProjects (server render)', async () => {
  const { render } = await import('svelte/server');
  const { createRawSnippet } = await import('svelte');
  const { default: SentenceProjects } = await import('$lib/components/projects/sentence/SentenceProjects.svelte');
  const { toEntries, countEntries } = await import('$lib/projects/views');

  const card = (key: string, kind: string, extra: Partial<ProjectCard> = {}): ProjectCard => ({
    key,
    href: `/projects/${key}/`,
    label: `Open ${key}`,
    kind,
    tag: 'Interactive',
    title: `${key} — the long name`,
    blurb: `About ${key}.`,
    chips: 'a · b',
    ...extra,
  });
  const view = (hand: ProjectCard[], agent: ProjectCard[], owner: boolean, isPublic: (key: string) => boolean = () => true) => {
    const e = toEntries(hand, agent, isPublic);
    return render(SentenceProjects, {
      props: {
        ...e,
        showAgent: agent.length > 0 || owner,
        counts: countEntries(e.hand, e.agent),
        owner,
        dateline: 'Sun 11 Oct',
        controls: createRawSnippet((x: () => ProjectEntry) => ({ render: () => `<span class="ctl-test">${x().key}</span>` })),
        switcher: createRawSnippet(() => ({ render: () => '<div class="switch-test"></div>' })),
      },
    }).body;
  };

  it('reads for the public with no agent chapter at all', () => {
    const html = view([card('marbler', 'Game'), card('scs', 'Field Study №6')], [], false);
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    expect(html.match(/class="switch-test"/g)?.length).toBe(1);
    expect(html).not.toContain('Written by an agent');
    expect(html).not.toContain('ctl-test');
    expect(html).not.toContain('only I can see');
    expect(html).toContain('href="/projects/marbler/"');
    expect(html).toContain('href="#sp-scs"');
    expect(html).toContain('takes one chapter');
  });

  it('gives the owner the controls, the private marks and an empty agent chapter that says so', () => {
    const html = view([card('hex', 'Game'), card('wm', 'Simulation', { ownerOnly: true, external: true, href: 'http://example.test/' })], [], true, (k) => k !== 'hex');
    expect(html.match(/class="ctl-test"/g)?.length).toBe(2);
    expect(html).toContain('only I can see this');
    expect(html).toContain('never public');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('Nothing here yet.');
    expect(html).toContain('2 only I can see');
  });
});
