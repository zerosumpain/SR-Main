// nav.ts — the information architecture, in one place.
//
// The study used to walk the whole site: five parts over twenty-nine pages, from how a chat
// message is streamed to where the backups live. Most of that is ordinary engineering, and
// all of it was hand-copied, so it went stale as fast as the site changed. It now covers the
// three things here that are genuinely unusual — the daydream loop, a site that builds its
// own changes, and the iPhone app around it — and reads its facts from the code that runs
// them. The nav, the hubs and the next/previous links all read from this file.

import { DAYDREAM_COPY } from './daydream';
import { BUILD_COPY } from './build';
import { APP_COPY } from './app';

export const B = '/projects/engine-room';

export type PartId = 'daydream' | 'build' | 'app';

export interface Leaf {
  /** Path segment under the part. */
  slug: string;
  /** The feature's name on the site. Also the page's H1 and browser title. */
  label: string;
  /** One line for hubs and nav. Under 15 words. */
  blurb: string;
  /** What you can operate on the page. Shown on hub cards. */
  instrument: string;
}

export interface Part {
  id: PartId;
  no: string;
  name: string;
  /** The question the part answers, in plain words. */
  strap: string;
  /** One line under the hub title. */
  lede: string;
  /** CSS colour token for the part's accent. */
  tone: string;
  leaves: Leaf[];
}

export const PARTS: Part[] = [
  {
    id: 'daydream',
    ...DAYDREAM_COPY.hub,
    no: 'I',
    name: 'Daydream',
    tone: 'var(--accent)',
    leaves: [
      { slug: 'questions', label: 'Questions', instrument: 'The schedule of what it asks, and what it will ask next',
        blurb: 'One narrow question per cycle, chosen by the clock' },
      { slug: 'inbox', label: 'Inbox', instrument: 'Each stage and the double-check, with whose move it is',
        blurb: 'Every note’s journey, and where I come in' },
      { slug: 'impact', label: 'Impact', instrument: 'Live weekly verdicts and the funnel from spotted to done',
        blurb: 'The only score that counts is whether it helped' },
    ],
  },
  {
    id: 'build',
    ...BUILD_COPY.hub,
    no: 'II',
    name: 'Build',
    tone: 'var(--accent-ink)',
    leaves: [
      { slug: 'backlog', label: 'Backlog', instrument: 'Where ideas come from, and the nightly run that works them',
        blurb: 'One queue for every idea, worked on overnight' },
      { slug: 'develop', label: 'Develop', instrument: 'Step a delivery from brief to deployed',
        blurb: 'An accepted idea, built, previewed and released' },
      { slug: 'verify', label: 'Verification', instrument: 'The proof chain a build walks before it ships',
        blurb: 'The same checks my own changes get, then again' },
      { slug: 'codegraph', label: 'Codegraph', instrument: 'Edge kinds and the arithmetic that ranks a lesson',
        blurb: 'Every build leaves notes for the next one' },
    ],
  },
  {
    id: 'app',
    ...APP_COPY.hub,
    no: 'III',
    name: 'App',
    tone: '#2d7a3a',
    leaves: [
      { slug: 'surfaces', label: 'Surfaces', instrument: 'Pick a place on the phone or watch, see what lives there',
        blurb: 'Tabs, widgets, the Lock Screen, the watch and Siri' },
      { slug: 'api', label: 'Native API', instrument: 'Every endpoint the app can call, grouped by what it’s for',
        blurb: 'One guarded doorway between the phone and the site' },
      { slug: 'privacy', label: 'Permissions', instrument: 'Each permission and capability, and what it’s for',
        blurb: 'What it asks the phone for, and why' },
    ],
  },
];

export const partById = (id: PartId) => PARTS.find((p) => p.id === id)!;
export const href = (part: PartId, slug?: string) => (slug ? `${B}/${part}/${slug}` : `${B}/${part}`);

/** Flat reading order: index → part → its leaves → next part … Used for prev/next links. */
export interface Step { href: string; label: string; part?: PartId }
export const ORDER: Step[] = [
  { href: B, label: 'The Engine Room' },
  ...PARTS.flatMap((p) => [
    { href: href(p.id), label: p.name, part: p.id },
    ...p.leaves.map((l) => ({ href: href(p.id, l.slug), label: l.label, part: p.id })),
  ]),
];

export const neighbours = (pathname: string) => {
  const clean = pathname.replace(/\/$/, '');
  const i = ORDER.findIndex((s) => s.href === clean);
  return { prev: i > 0 ? ORDER[i - 1] : null, next: i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null };
};

/**
 * Every public URL this study has ever had → where it lives now (308).
 *
 * Keyed by the path under the study, without a leading slash. The pages that covered the
 * build carry on as the Build part; the offline maps carried on into the app; everything
 * the study no longer covers goes to the index rather than to a 404.
 */
export const REDIRECTS: Record<string, string> = {
  // The study's first, flat version.
  codegraph: href('build', 'codegraph'),
  building: href('build', 'backlog'),
  shipping: href('build', 'develop'),
  guardrails: href('build', 'verify'),
  trace: B, chat: B, models: B, tools: B, research: B, automation: B,
  // The five-part version.
  change: href('build'),
  'change/lessons': href('build', 'codegraph'),
  'change/nights': href('build', 'backlog'),
  'change/gate': href('build', 'verify'),
  'change/shipping': href('build', 'develop'),
  'change/limits': href('build', 'verify'),
  'reach/trails': href('app'),
  ...Object.fromEntries(
    [
      'turn', 'turn/trace', 'turn/stream', 'turn/routing', 'turn/latency', 'turn/cost',
      'memory', 'memory/channels', 'memory/entities', 'memory/trust', 'memory/graph', 'memory/watch',
      'memory/retrieval', 'memory/store', 'memory/research',
      'reach', 'reach/decks', 'reach/drive', 'reach/workflows', 'reach/house', 'reach/feeds',
      'reach/tools', 'reach/mcp', 'reach/keys',
      'ground', 'ground/estate', 'ground/storage',
    ].map((k) => [k, B]),
  ),
};
