// The daydream chat toolset (overhaul plan 2026-10-28, point 8). Reads from
// slice 4; the mutates from slice 7a, after principal phase 2 (decision 12:
// chat may read, discuss, rate and correct notes and PREPARE double-checks;
// "do it" only behind a confirm card; sign-off on a double-check stays on the
// Inbox and the phone card). `sendIt` is never exposed, and neither is
// `never_kind` (a mute of a whole kind is one tap on the Inbox, not a chat
// guess).
//
//   daydream_rate          mutate, light: a verdict or a one-tap reason
//   daydream_correct       mutate, light: "wrong, because…" / "right" in his
//                          exact words (the card shows them; they become a
//                          binding lesson), or a note added to the note
//   daydream_double_check  mutate, light: PREPARES the double-check; approval
//                          is the Inbox's SignOff or the phone card
//   daydream_do            mutate, confirm always: "do it for me" and its undo
//
// Wraps the loaders the Inbox and the phone already use and adds no logic of
// its own beyond `think/relevance.ts`. Results are labelled as derived: a
// note is something jkai NOTICED, not a confirmed fact, and nothing here is
// written to personal memory.
//
// Owner-only: not member-safe, not on the WhatsApp list, not offered to the
// heartbeat, and refused in the handler for any other principal.
//
// Registered from daydream's side (src/hooks.server.ts imports this module at
// boot) rather than imported by $lib/tools/registry: daydream already reaches
// the tool executor, so the registry importing daydream back would be a cycle.

import { register } from '$lib/tools/registry-internal';
import { loadDaydreamSummary } from '$lib/daydream/summary.server';
import { loadFeedNote } from '$lib/daydream/think/notes.server';
import { STAGE_LABEL } from '$lib/daydream/think/explain';
import { noteHref } from '$lib/daydream/think/notes';
import { refuseUnlessOwner } from '$lib/tools/tools/owner-only';
import { REASONS, isReason } from '$lib/daydream/reasons';

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

// ── Mutates (slice 7a) ──────────────────────────────────────────────────────

const idParam = { id: { type: 'string', description: 'The note id, from daydream_inbox or a /jkai/daydreams?note= link.' } };
const noteId = (args: Record<string, unknown>) => (typeof args.id === 'string' ? args.id.trim().slice(0, 200) : '');
const failed = (err: unknown, fallback: string) => ({ success: false as const, error: (err instanceof Error ? err.message : fallback).slice(0, 300) });

register({
  name: 'daydream_rate',
  effect: 'mutate',
  description:
    "Rate a daydream note for John: verdict 'useful' (worth knowing) or 'not_useful' (not for me), or one of his one-tap reasons — already_knew, not_my_thing, not_now (files it with no verdict), did_it. Only when he has said so in this conversation. A short card asks him first.",
  parameters: {
    type: 'object',
    properties: {
      ...idParam,
      verdict: { type: 'string', enum: ['useful', 'not_useful'], description: 'His verdict. Omit when giving a reason instead.' },
      reason: { type: 'string', enum: [...REASONS], description: 'His reason, when he gave one.' },
      note: { type: 'string', description: 'Optional: his own words on why, kept with the verdict.' },
    },
    required: ['id'],
  },
  category: 'Daydream',
  toolset: 'daydream',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('daydream_rate', ctx);
    if (refused) return refused;
    const id = noteId(args);
    if (!id) return { success: false, error: 'id is required' };
    try {
      if (args.reason !== undefined) {
        if (!isReason(args.reason)) return { success: false, error: `reason must be one of ${REASONS.join(', ')}` };
        const { recordReason } = await import('$lib/daydream/reasons.server');
        const res = await recordReason(id, args.reason);
        return { success: true, data: { id, reason: args.reason, verdict: res.verdict, citation: citation(id, 'the note'), message: 'Recorded.' } };
      }
      if (args.verdict !== 'useful' && args.verdict !== 'not_useful') return { success: false, error: 'Give a verdict (useful or not_useful) or a reason.' };
      const { recordFeedback } = await import('$lib/daydream/thought-store');
      const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim().slice(0, 500) : undefined;
      await recordFeedback(id, args.verdict, note);
      return { success: true, data: { id, verdict: args.verdict, message: 'Recorded.' } };
    } catch (err) {
      return failed(err, 'Could not rate that note.');
    }
  },
});

register({
  name: 'daydream_correct',
  effect: 'mutate',
  description:
    "Correct a daydream note in John's EXACT words. verdict 'wrong' with why (his reason, verbatim — it becomes a binding lesson the loop learns from), or 'right' to confirm a claim; or note to add his own words to the note without a verdict. Never paraphrase him. A card shows his words before it is saved.",
  parameters: {
    type: 'object',
    properties: {
      ...idParam,
      verdict: { type: 'string', enum: ['wrong', 'right'], description: 'Whether the note\'s claim is wrong or right.' },
      why: { type: 'string', description: 'His reason, verbatim. Required for wrong.' },
      note: { type: 'string', description: 'His own words to add to the note, verbatim, when he is not ruling on it.' },
    },
    required: ['id'],
  },
  category: 'Daydream',
  toolset: 'daydream',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('daydream_correct', ctx);
    if (refused) return refused;
    const id = noteId(args);
    if (!id) return { success: false, error: 'id is required' };
    try {
      if (args.verdict === undefined && typeof args.note === 'string') {
        const { addNote } = await import('$lib/daydream/notes');
        const result = await addNote(id, args.note);
        return { success: true, data: { id, noted: args.note.trim().slice(0, 500), result, message: 'Added to the note.' } };
      }
      const { parseOwnerVerdict, recordOwnerVerdict } = await import('$lib/daydream/owner-verdict');
      const parsed = parseOwnerVerdict({ thoughtId: id, verdict: args.verdict, why: args.why });
      if (!parsed.ok) return { success: false, error: parsed.error };
      await recordOwnerVerdict(parsed.thoughtId, parsed.verdict, parsed.why);
      return { success: true, data: { id, verdict: parsed.verdict, why: parsed.why, message: parsed.verdict === 'wrong' ? 'Recorded as wrong; his reason is now a lesson.' : 'Recorded as right.' } };
    } catch (err) {
      return failed(err, 'Could not record that.');
    }
  },
});

register({
  name: 'daydream_double_check',
  effect: 'mutate',
  description:
    'PREPARE a double-check of a daydream note: jkai will re-read the sources and try to prove the note wrong. This only prepares it — John approves it on the daydream Inbox or the phone card, never in chat. Returns the link to the sign-off.',
  parameters: { type: 'object', properties: { ...idParam }, required: ['id'] },
  category: 'Daydream',
  toolset: 'daydream',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('daydream_double_check', ctx);
    if (refused) return refused;
    const id = noteId(args);
    if (!id) return { success: false, error: 'id is required' };
    const { commissioningEnabled, prepareCommission } = await import('$lib/daydream/commission-service.server');
    if (!commissioningEnabled()) return { success: false, error: 'Double-checks are not switched on here, so none was prepared.' };
    try {
      const prepared = (await prepareCommission(id)) as { id?: string; state?: string } | null;
      const commissionId = prepared?.id ? String(prepared.id) : null;
      return {
        success: true,
        data: {
          id,
          commissionId,
          state: prepared?.state ?? 'awaiting_approval',
          signOff: commissionId ? `/jkai/daydreams?commission=${encodeURIComponent(commissionId)}` : '/jkai/daydreams',
          message: 'Prepared. It runs only once John approves it on the Inbox or the phone card — say so, with the link.',
        },
      };
    } catch (err) {
      return failed(err, 'Could not prepare a double-check.');
    }
  },
});

register({
  name: 'daydream_do',
  effect: 'mutate',
  confirm: 'always',
  description:
    'Carry out a daydream note\'s suggested step for John ("do it for me"): a calendar entry, a reminder, a calendar move or batch, an event hold, or an email DRAFT (never sent). John confirms first. Pass undo: true to take it back. Use only when he asks.',
  parameters: {
    type: 'object',
    properties: { ...idParam, undo: { type: 'boolean', description: 'True to undo what was done for this note.' } },
    required: ['id'],
  },
  category: 'Daydream',
  toolset: 'daydream',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('daydream_do', ctx);
    if (refused) return refused;
    const id = noteId(args);
    if (!id) return { success: false, error: 'id is required' };
    try {
      const { doIt, undoIt } = await import('$lib/daydream/act/act.server');
      const out = args.undo === true ? await undoIt(id) : await doIt(id);
      if (!out.ok) return { success: false, error: out.reason, ...(out.needsCalendar ? { data: { needsCalendar: true, calendars: out.calendars } } : {}) };
      return { success: true, data: { id, status: out.status, label: out.label, ...(out.calendar ? { calendar: out.calendar } : {}), ...(out.already ? { already: true } : {}), undo: out.status === 'done' ? { id, undo: true } : null } };
    } catch (err) {
      return failed(err, 'Could not do that.');
    }
  },
});
