import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import NotesProjects from './NotesProjects.svelte';
import { countEntries, toEntries, type ProjectCard, type ProjectEntry } from '$lib/projects/views';

const card = (key: string, kind: string, extra: Partial<ProjectCard> = {}): ProjectCard => ({
  key,
  href: `/projects/${key}/`,
  label: `Open ${key}`,
  kind,
  tag: 'Interactive',
  title: `${key} — the long title`,
  blurb: `What ${key} does.`,
  chips: 'one · two',
  ...extra,
});

const controls = createRawSnippet((e: () => ProjectEntry) => ({ render: () => `<span class="ctl-test">${e().key}</span>` }));
const switcher = createRawSnippet(() => ({ render: () => '<div class="switch-test"></div>' }));

function page(opts: { agent?: ProjectCard[]; owner?: boolean; showAgent?: boolean; hidden?: string[] }) {
  const hand = [card('hex', 'Game'), card('scs', 'Field Study №6', { product: true }), card('keystone', 'Tool')];
  const e = toEntries(hand, opts.agent ?? [], (k) => !(opts.hidden ?? []).includes(k));
  return render(NotesProjects, {
    props: {
      hand: e.hand,
      agent: e.agent,
      showAgent: opts.showAgent ?? false,
      counts: countEntries(e.hand, e.agent),
      owner: opts.owner ?? false,
      dateline: 'Sun 11 Oct',
      controls,
      switcher,
    },
  }).body;
}

describe('NotesProjects', () => {
  it('draws one h1, the switch once, and a card link with its accessible name per project', () => {
    const html = page({});
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html.match(/switch-test/g)?.length).toBe(1);
    expect(html).toContain('aria-label="Open hex"');
    expect(html.match(/class="ctl-test"/g)?.length).toBe(3);
    expect(html).toContain('Sun 11 Oct');
  });

  it('files every project on the contents page, pointing at its card', () => {
    const html = page({});
    expect(html).toContain('href="#pn-hex"');
    expect(html).toContain('id="pn-hex"');
  });

  it('for the public with no agent builds: no agent page, no agent tally, no private marks', () => {
    const html = page({});
    expect(html).not.toContain('Written by an agent');
    expect(html).not.toContain('by an agent</span>');
    expect(html).not.toMatch(/class="pk[^"]*private/);
    expect(html).toContain('All of them made by hand.');
  });

  it('says plainly when the owner’s agent page is empty', () => {
    const html = page({ owner: true, showAgent: true });
    expect(html).toContain('Written by an agent');
    expect(html).toContain('Nothing here yet');
  });

  it('numbers the agent builds on from the hand-built ones and tapes them in', () => {
    const html = page({ owner: true, showAgent: true, agent: [card('tide', 'AI Built')], hidden: ['tide'] });
    expect(html).toContain('start="4"');
    expect(html).toMatch(/id="pn-tide"[^>]*data-fix="tape"/);
    expect(html).toContain('only I can see');
  });

  it('marks a finished product as a kind apart', () => {
    expect(page({})).toMatch(/class="pk[^"]*product" id="pn-scs"/);
  });
});
