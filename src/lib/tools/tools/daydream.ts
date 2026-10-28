// The daydream chat toolset — READS only (overhaul plan 2026-10-28, point 8,
// slice 4). Rating, correcting, double-checking and acting arrive with
// principal phase 2; `sendIt` is never exposed.
//
// Wraps the loaders the Inbox and the phone already use and adds no logic of
// its own beyond `think/relevance.ts`. Results are labelled as derived: a
// note is something jkai NOTICED, not a confirmed fact, and nothing here is
// written to personal memory.
//
// Owner-only: not member-safe, not on the WhatsApp list, not offered to the
// heartbeat, and refused in the handler for any other principal.

import { register } from '../registry-internal';
import { loadDaydreamSummary } from '$lib/daydream/summary.server';
import { loadFeedNote } from '$lib/daydream/think/notes.server';
import { STAGE_LABEL } from '$lib/daydream/think/explain';
import { noteHref } from '$lib/daydream/think/notes';
import { refuseUnlessOwner } from './owner-only';

const DERIVED = 'daydream (derived): something jkai noticed from what it read, not a confirmed fact';

const citation = (id: string, title: string) => `[${title.replace(/[[\]]/g, '')}](${noteHref(id)})`;

register({
  name: 'daydream_inbox',
  description:
    "What the daydream loop has noticed and what is waiting on John: double-checks needing his OK, reports that came back, and drafted follow-ups, with counts of unrated and in-motion notes. Pass a query to find notes about a subject from the last week. Each note carries a ready citation link; say a note is something jkai noticed, not a fact. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional subject to match notes against, in plain words.' },
      limit: { type: 'number', minimum: 1, maximum: 10, description: 'Most notes per list. Defaults to 5.' },
    },
    required: [],
  },
  category: 'Daydream',
  toolset: 'daydream',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('daydream_inbox', ctx);
    if (refused) return refused;
    const query = typeof args.query === 'string' ? args.query.trim().slice(0, 300) : '';
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(10, Math.trunc(args.limit))) : 5;
    const summary = await loadDaydreamSummary({ q: query || null, limit });
    return {
      success: true,
      data: {
        label: DERIVED,
        counts: summary.counts,
        waiting: summary.waiting.map((n) => ({ ...n, citation: citation(n.id, n.title) })),
        ...(query ? { query, matched: summary.matched.map((n) => ({ ...n, citation: citation(n.id, n.title) })) } : {}),
        inboxUrl: '/jkai/daydreams',
        message:
          summary.counts.waitingOnYou === 0 && (!query || summary.matched.length === 0)
            ? 'Nothing from daydream is waiting on John.'
            : 'Cite each note with its link; open daydream_note_get for its sources.',
      },
    };
  },
});

register({
  name: 'daydream_note_get',
  description:
    'One daydream note by id: what it says, the suggested next step, the sources it read, where it is (spotted, your call, in motion, result), any double-check and its verdict, and a ready citation link. Use before discussing a note in detail. The note is derived evidence: quote its sources, not the note, as fact. Read-only.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'The note id, from daydream_inbox or a /jkai/daydreams?note= link.' } },
    required: ['id'],
  },
  category: 'Daydream',
  toolset: 'daydream',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('daydream_note_get', ctx);
    if (refused) return refused;
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) return { success: false, error: 'id is required' };
    const note = await loadFeedNote(id);
    if (!note) return { success: false, error: `No daydream note ${id}` };
    return {
      success: true,
      data: {
        label: DERIVED,
        id: note.id,
        title: note.title,
        citation: citation(note.id, note.title),
        url: note.url,
        createdAt: note.createdAt,
        channel: note.channelLabel,
        outcome: note.outcomeLabel,
        summary: note.summary,
        next: note.next,
        read: note.read,
        sources: note.sources.map((s) => ({ label: s.label, detail: s.detail, ...(s.href ? { href: s.href } : {}) })),
        stage: STAGE_LABEL[note.stage],
        waitingOnJohn: note.bucket === 'decide',
        rated: note.verdict,
        ownerNote: note.ownerNote,
        review: note.review,
        doubleCheck: note.commission ? { id: note.commission.id, state: note.commission.state, url: `/jkai/daydreams?commission=${encodeURIComponent(note.commission.id)}` } : null,
        stale: note.stale ? note.stale.why : null,
        replaces: note.replaces,
      },
    };
  },
});
