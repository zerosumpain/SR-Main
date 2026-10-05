// src/lib/daydream/act/follow.server.ts
//
// Carrying out a note's follow-ups (`follow.ts` says which a note gets, what
// each costs and how it is stored). Every call is the owner's own tap on his
// own note: the route is behind the Auth.js gate, and each function re-reads
// the note under an advisory lock so a double tap does the work once.
//
// The improvement backlog is reached through `BacklogPorts`, handed in by the
// route: `$lib/selfimprove` imports `$lib/daydream`, so importing it back from
// here would close a module cycle (the same reason `queueBuildNotes` lives in
// the heartbeat activity).

import { eq, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { daydreamThoughts, gmailAccounts, jkaiBuilds, researchSessions } from '$lib/db/schema';
import { splitNarrative, describeSources } from '../think/explain';
import { noteHref } from '../think/notes';
import { resolveDaydreamModel } from '../model';
import {
  MAX_HOME_REFRESH,
  PROTOTYPE_BUDGET,
  PROTOTYPE_QUOTA_CEILING,
  addressIsCited,
  briefView,
  cleanWatchDescription,
  contactsIn,
  evidenceText,
  followEntry,
  messagePrompt,
  noteBacked,
  noteTurnedDown,
  pickHomeEntities,
  prototypePrompt,
  readFollow,
  webLinks,
  withFollow,
  type BuildData,
  type FollowKind,
  type HomeData,
  type MessageData,
  type WatchData,
} from './follow';

/** The improvement backlog, as this module needs it. Built in the route. */
export interface BacklogPorts {
  /** The single intake door. Returns the item's slug, or why there is none. */
  intake(idea: { title: string; detail: string; ref: string }): Promise<{ slug: string } | { reason: string }>;
  item(slug: string): Promise<{ slug: string; title: string; detail: string; kind: string; priority: number; status: string } | null>;
  /** Groom it as a development brief. Read-only: nothing is saved. */
  groom(item: { slug: string; title: string; detail: string; kind: string; priority: number }): Promise<Record<string, unknown>>;
  /** Save the brief — which IS the acceptance (`acceptGrooming`). */
  accept(item: { slug: string; title: string; detail: string; kind: string; priority: number }, grooming: Record<string, unknown>): Promise<void>;
}

export type FollowResult = { ok: true; message: string; href?: string } | { ok: false; reason: string };

interface NoteRow {
  id: string;
  kind: string;
  title: string;
  narrative: string | null;
  explanation: string;
  evidence: unknown;
  feedback: string | null;
  reviewVerdict: string | null;
  actions: unknown;
}

const FROM_STORED: Record<string, 'holds' | 'wrong' | 'unclear'> = { verified: 'holds', refuted: 'wrong', uncertain: 'unclear' };

async function lockedRow(tx: DbExecutor, thoughtId: string): Promise<NoteRow | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`daydream-follow:${thoughtId}`}))`);
  const [row] = await tx
    .select({
      id: daydreamThoughts.id,
      kind: daydreamThoughts.kind,
      title: daydreamThoughts.title,
      narrative: daydreamThoughts.narrative,
      explanation: daydreamThoughts.explanation,
      evidence: daydreamThoughts.evidence,
      feedback: daydreamThoughts.feedback,
      reviewVerdict: daydreamThoughts.reviewVerdict,
      actions: daydreamThoughts.proposedActions,
    })
    .from(daydreamThoughts)
    .where(eq(daydreamThoughts.id, thoughtId))
    .limit(1);
  return row ?? null;
}

function words(row: NoteRow): { summary: string; next: string | null } {
  return splitNarrative(row.narrative ?? row.explanation);
}

function review(row: NoteRow) {
  const verdict = row.reviewVerdict ? FROM_STORED[row.reviewVerdict] : undefined;
  return verdict ? { verdict, by: 'check' as const, reasoning: '', lesson: null } : null;
}

async function store(tx: DbExecutor, row: NoteRow, kind: FollowKind, label: string, data: object, now: Date): Promise<void> {
  await tx
    .update(daydreamThoughts)
    .set({ proposedActions: withFollow(row.actions, followEntry(kind, label, data, now)) as Array<{ kind: string; label: string; payload: string }>, updatedAt: now })
    .where(eq(daydreamThoughts.id, row.id));
}

/** Run `fn` on the locked note, refusing a note he turned down. */
async function onNote(thoughtId: string, fn: (tx: DbExecutor, row: NoteRow) => Promise<FollowResult>): Promise<FollowResult> {
  return db.transaction(async (tx) => {
    const row = await lockedRow(tx, thoughtId);
    if (!row) return { ok: false, reason: 'That note no longer exists.' };
    if (noteTurnedDown(row.feedback, review(row))) return { ok: false, reason: 'You turned this note down, so there is nothing to take further.' };
    return fn(tx, row);
  });
}

/** A JSON object out of a model reply, tolerating a fence. */
function jsonOf(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(reply.slice(start, end + 1));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── Dig deeper: a brief research run ───────────────────────────────────────

export async function digDeeper(thoughtId: string, now = new Date()): Promise<FollowResult> {
  let started: string | null = null;
  const res = await onNote(thoughtId, async (tx, row) => {
    const had = readFollow(row.actions).research?.data.sessionId;
    if (typeof had === 'string') return { ok: true, message: 'Research is already running on this.', href: `/research/${had}` };
    const { summary, next } = words(row);
    const links = webLinks(row.evidence, describeSources(row.evidence)).slice(0, 3);
    const { depthPreset } = await import('$lib/deepdive/depth');
    const { coerceScope } = await import('$lib/deepdive/scope');
    const preset = depthPreset('brief');
    const [session] = await tx
      .insert(researchSessions)
      .values({
        topic: row.title.slice(0, 300),
        goals: [
          `Check what this daydream note says and add what it leaves out: ${summary.replace(/\s+/g, ' ').slice(0, 400)}`,
          ...(next ? [`Make the next step concrete — where, when, cost, how to book or start: ${next.slice(0, 300)}`] : []),
        ],
        depth: 'brief',
        grounding: 'off',
        scope: coerceScope({ mode: 'open', seedUrls: links }),
        budgetMs: preset.budgetMs,
        config: preset.config,
        status: 'draft',
        principalId: 'owner',
      })
      .returning({ id: researchSessions.id });
    await store(tx, row, 'research', 'Research started', { sessionId: session.id }, now);
    started = session.id;
    return { ok: true, message: 'Research started — a brief run, back in a few minutes.', href: `/research/${session.id}` };
  });
  // Started after the commit: the worker reads the session row.
  if (started) {
    const { startResearch } = await import('$lib/deepdive/worker');
    startResearch(started);
  }
  return res;
}

// ── The backlog: put it on, then accept it for build ───────────────────────

export async function promote(thoughtId: string, ports: BacklogPorts, now = new Date()): Promise<FollowResult> {
  return onNote(thoughtId, async (tx, row) => {
    const had = readFollow(row.actions).promote?.data.slug;
    if (typeof had === 'string') return { ok: true, message: 'It is already on the backlog.', href: `/jkai/develop/backlog?item=${encodeURIComponent(had)}` };
    if (row.kind === 'think_build') return { ok: false, reason: 'Build ideas go to the backlog by themselves.' };
    if (!noteBacked(row.feedback, review(row))) {
      return { ok: false, reason: 'Say it is worth knowing (or have it double-checked) first — the backlog only takes ideas that have held up.' };
    }
    const { summary, next } = words(row);
    const res = await ports.intake({
      title: row.title.slice(0, 200),
      detail: `${summary}${next ? `\n\nNext: ${next}` : ''}\n\nPut on the backlog from a daydream note: ${noteHref(row.id)}`.slice(0, 2000),
      ref: `thought:${row.id}`,
    });
    if ('reason' in res) return { ok: false, reason: res.reason };
    await store(tx, row, 'promote', 'On the backlog', { slug: res.slug }, now);
    return { ok: true, message: 'On the backlog as Proposed. Draft and accept its brief to have it built.', href: `/jkai/develop/backlog?item=${encodeURIComponent(res.slug)}` };
  });
}

/** The backlog item this note became: its own build idea, or the one he promoted. */
async function backlogSlugFor(row: NoteRow): Promise<string | null> {
  const promoted = readFollow(row.actions).promote?.data.slug;
  if (typeof promoted === 'string') return promoted;
  const { loadNoteContexts } = await import('../think/context.server');
  const ctx = (await loadNoteContexts([{ id: row.id, evidence: row.evidence }])).get(row.id);
  return ctx?.build?.slug ?? null;
}

/** Draft the groomed brief for him to read. Nothing is saved to the backlog. */
export async function draftBrief(thoughtId: string, ports: BacklogPorts, now = new Date()): Promise<FollowResult> {
  return onNote(thoughtId, async (tx, row) => {
    const slug = await backlogSlugFor(row);
    if (!slug) return { ok: false, reason: 'This note has no backlog item yet.' };
    const item = await ports.item(slug);
    if (!item) return { ok: false, reason: 'Its backlog item has gone.' };
    if (item.status !== 'open') return { ok: false, reason: `Its backlog item is ${item.status}, not open.` };
    let grooming: Record<string, unknown>;
    try {
      grooming = await ports.groom(item);
    } catch (err) {
      return { ok: false, reason: `The brief could not be drafted just now: ${String(err instanceof Error ? err.message : err).slice(0, 160)}` };
    }
    const data: BuildData = {
      slug,
      grooming,
      brief: briefView(grooming),
      title: item.title,
      detail: item.detail,
      kind: item.kind,
      priority: item.priority,
      acceptedAt: null,
    };
    await store(tx, row, 'build', 'Brief drafted', data, now);
    return { ok: true, message: 'Brief drafted — read it, then accept it for build.' };
  });
}

/** His tap on the brief he read. Saving it stamps `grooming.acceptedAt`. */
export async function acceptBuild(thoughtId: string, ports: BacklogPorts, now = new Date()): Promise<FollowResult> {
  return onNote(thoughtId, async (tx, row) => {
    const data = readFollow(row.actions).build?.data as BuildData | undefined;
    if (!data?.slug || !data.grooming) return { ok: false, reason: 'Draft the brief first, so you know what you are accepting.' };
    const href = `/jkai/develop/backlog?item=${encodeURIComponent(data.slug)}`;
    if (data.acceptedAt) return { ok: true, message: 'Already accepted.', href };
    const item = await ports.item(data.slug);
    if (!item || item.status !== 'open') return { ok: false, reason: 'Its backlog item is no longer open.' };
    await ports.accept({ slug: item.slug, title: item.title, detail: item.detail, kind: item.kind, priority: item.priority }, data.grooming);
    await store(tx, row, 'build', 'Accepted for build', { ...data, acceptedAt: now.toISOString() }, now);
    return { ok: true, message: 'Accepted. The builder takes one accepted item a night.', href };
  });
}

// ── A quick prototype ──────────────────────────────────────────────────────

export async function startPrototype(thoughtId: string, now = new Date()): Promise<FollowResult> {
  // The quota check is outside the transaction: it is a network read.
  const { readQuotaMark } = await import('../budget');
  const mark = await readQuotaMark().catch(() => null);
  if (mark && (mark.fiveHourPct >= PROTOTYPE_QUOTA_CEILING.fiveHourPct || mark.weeklyPct >= PROTOTYPE_QUOTA_CEILING.weeklyPct)) {
    return { ok: false, reason: `The ChatGPT subscription is ${Math.round(Math.max(mark.fiveHourPct, mark.weeklyPct))}% used, so it will not start a build now. Try after the window resets.` };
  }
  let buildId: string | null = null;
  const res = await onNote(thoughtId, async (tx, row) => {
    const had = readFollow(row.actions).prototype?.data.buildId;
    if (typeof had === 'string') return { ok: true, message: 'A prototype is already under way.', href: `/jkai/builds/${had}` };
    if (row.kind !== 'think_build' && !noteBacked(row.feedback, review(row))) {
      return { ok: false, reason: 'Say it is worth knowing first — a prototype spends real build time.' };
    }
    const { summary, next } = words(row);
    const prompt = prototypePrompt(row.title, summary, next);
    const { resolveBuilderModel } = await import('$lib/server/models/workload-settings');
    const ctx = await resolveBuilderModel();
    const [build] = await tx
      .insert(jkaiBuilds)
      .values({
        title: `Prototype: ${row.title}`.slice(0, 100),
        prompt,
        planStatus: 'approved',
        budgetConfig: { ...PROTOTYPE_BUDGET },
        modelProvider: ctx.provider,
        modelId: ctx.modelId,
      } as never)
      .returning({ id: jkaiBuilds.id });
    buildId = build.id;
    await store(tx, row, 'prototype', 'Prototype started', { buildId: build.id, prompt }, now);
    return { ok: true, message: 'Prototype started — capped at 45 minutes.', href: `/jkai/builds/${build.id}` };
  });
  if (res.ok && buildId) {
    const { orchestrator } = await import('$lib/jkai/orchestrator');
    try {
      await orchestrator.startBuild(buildId);
    } catch (err) {
      await db.update(jkaiBuilds).set({ status: 'failed' } as never).where(eq(jkaiBuilds.id, buildId));
      return { ok: false, reason: `The builder could not be reached: ${String(err instanceof Error ? err.message : err).slice(0, 160)}` };
    }
  }
  return res;
}

// ── A Watch instead of a build ─────────────────────────────────────────────

/** A watch takes a minute to generate; a second tap meanwhile is refused. */
const watchesInFlight = new Set<string>();

export async function startWatch(thoughtId: string, description: unknown, now = new Date()): Promise<FollowResult> {
  const desc = cleanWatchDescription(description);
  if (!desc) return { ok: false, reason: 'Say what to watch for in a sentence (12 to 400 characters).' };
  // The generator is a model call and can take a minute: claim the note
  // first, so a second tap does not build a second watch.
  const claim = await onNote(thoughtId, async (_tx, row) => {
    const had = readFollow(row.actions).watch?.data as Partial<WatchData> | undefined;
    if (had?.workflowId && !had.stoppedAt) return { ok: false, reason: 'It is already watching for this.' };
    return { ok: true, message: '' };
  });
  if (!claim.ok) return claim;
  if (watchesInFlight.has(thoughtId)) return { ok: false, reason: 'It is already setting this watch up.' };
  watchesInFlight.add(thoughtId);
  const { createMonitor } = await import('$lib/monitors/monitors.server');
  let marker;
  try {
    marker = await createMonitor(`${desc} (From a daydream note: ${noteHref(thoughtId)})`, undefined);
  } catch (err) {
    return { ok: false, reason: String(err instanceof Error ? err.message : err).slice(0, 240) };
  } finally {
    watchesInFlight.delete(thoughtId);
  }
  return onNote(thoughtId, async (tx, row) => {
    const data: WatchData = { workflowId: marker.workflowId, description: desc, stoppedAt: null };
    await store(tx, row, 'watch', 'Watching', data, now);
    return { ok: true, message: `Watching — it checks on “${marker.cron}”.`, href: '/jkai/daydreams/watches' };
  });
}

export async function stopWatch(thoughtId: string, now = new Date()): Promise<FollowResult> {
  return onNote(thoughtId, async (tx, row) => {
    const had = readFollow(row.actions).watch?.data as Partial<WatchData> | undefined;
    if (!had?.workflowId) return { ok: false, reason: 'There is no watch on this note.' };
    if (had.stoppedAt) return { ok: true, message: 'Already stopped.' };
    const { deleteMonitor } = await import('$lib/monitors/monitors.server');
    await deleteMonitor(had.workflowId);
    await store(tx, row, 'watch', 'Watch stopped', { ...had, stoppedAt: now.toISOString() }, now);
    return { ok: true, message: 'Stopped and removed.' };
  });
}

// ── A message he sends himself ─────────────────────────────────────────────

export async function draftMessage(thoughtId: string, now = new Date()): Promise<FollowResult> {
  return onNote(thoughtId, async (tx, row) => {
    const { summary, next } = words(row);
    const { getLLMClient } = await import('$lib/llm/client');
    const { runToolLoop } = await import('$lib/llm/tool-loop');
    let reply: string;
    try {
      const { client, model } = await getLLMClient(await resolveDaydreamModel());
      const loop = await runToolLoop({
        client,
        model,
        messages: [
          { role: 'system', content: messagePrompt({ title: row.title, summary, next }) },
          { role: 'user', content: 'The JSON object, please.' },
        ],
        maxRounds: 1,
        temperature: 0.3,
        maxTokens: 600,
        activity: 'daydream',
        timeoutMs: 45_000,
        execute: async () => 'No tools here. Reply with the JSON object.',
      });
      reply = loop.reply;
    } catch {
      return { ok: false, reason: 'It could not draft a message just now. Try again in a minute.' };
    }
    const out = jsonOf(reply);
    const text = typeof out?.text === 'string' ? out.text.replace(/\r\n?/g, '\n').trim() : '';
    const subject = typeof out?.subject === 'string' ? out.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 150) : '';
    if (text.length < 20 || text.length > 1200) return { ok: false, reason: 'The draft came back unusable. Try again.' };
    // The recipient comes from the SOURCES' text, by code, or not at all.
    const found = contactsIn(evidenceText(row.evidence));
    const data: MessageData = {
      text,
      subject: subject || row.title.slice(0, 150),
      phone: found.phones[0] ?? null,
      email: found.emails[0] ?? null,
      draft: null,
    };
    await store(tx, row, 'message', 'Message drafted', data, now);
    return { ok: true, message: 'Drafted. Open it in WhatsApp or Mail and send it yourself.' };
  });
}

async function ownerMailbox() {
  const { ownerGmailWhere } = await import('$lib/integrations/gmail/owner-accounts');
  const { desc } = await import('drizzle-orm');
  const [acct] = await db
    .select()
    .from(gmailAccounts)
    .where(ownerGmailWhere(eq(gmailAccounts.status, 'active')))
    .orderBy(desc(gmailAccounts.updatedAt))
    .limit(1);
  return acct ?? null;
}

/** The message as a Gmail draft to the address the source names. Guided: he
 *  reads it on the card and sends with a second tap. */
export async function gmailDraft(thoughtId: string, now = new Date()): Promise<FollowResult> {
  return onNote(thoughtId, async (tx, row) => {
    const msg = readFollow(row.actions).message?.data as MessageData | undefined;
    if (!msg?.text) return { ok: false, reason: 'Draft the message first.' };
    if (msg.draft && !msg.draft.discardedAt) return { ok: true, message: msg.draft.sentAt ? 'Already sent.' : 'It is already in your Gmail drafts.' };
    const to = msg.email ?? '';
    if (!to || !addressIsCited(to, evidenceText(row.evidence))) return { ok: false, reason: 'None of the note’s sources gives an email address, so it will not guess one.' };
    const acct = await ownerMailbox();
    if (!acct) return { ok: false, reason: 'No Gmail account is connected to draft from.' };
    const { gmailService } = await import('$lib/integrations/gmail/service');
    const created = await gmailService.createDraft(acct, { to, subject: msg.subject, bodyText: `${msg.text}\n` });
    if (!created.draftId) return { ok: false, reason: 'Gmail did not keep the draft.' };
    const data: MessageData = { ...msg, draft: { id: created.draftId, messageId: created.messageId, to, accountEmail: acct.email, sentAt: null, discardedAt: null } };
    await store(tx, row, 'message', 'Drafted in Gmail', data, now);
    return { ok: true, message: `Drafted to ${to} — read it, then send.` };
  });
}

export async function sendGmailDraft(thoughtId: string, now = new Date()): Promise<FollowResult> {
  return onNote(thoughtId, async (tx, row) => {
    const msg = readFollow(row.actions).message?.data as MessageData | undefined;
    const d = msg?.draft;
    if (!msg || !d) return { ok: false, reason: 'There is no Gmail draft on this note.' };
    if (d.discardedAt) return { ok: false, reason: 'That draft was discarded.' };
    if (d.sentAt) return { ok: true, message: 'Already sent.' };
    const [acct] = await tx.select().from(gmailAccounts).where(eq(gmailAccounts.email, d.accountEmail)).limit(1);
    if (!acct) return { ok: false, reason: 'The mailbox it was drafted in is no longer connected.' };
    const { gmailService } = await import('$lib/integrations/gmail/service');
    try {
      await gmailService.sendDraft(acct, d.id);
    } catch (err) {
      return { ok: false, reason: `Gmail did not send it: ${String(err instanceof Error ? err.message : err).slice(0, 200)}. It may have been sent or deleted in Gmail already.` };
    }
    await store(tx, row, 'message', 'Sent', { ...msg, draft: { ...d, sentAt: now.toISOString() } }, now);
    return { ok: true, message: `Sent to ${d.to}.` };
  });
}

export async function discardGmailDraft(thoughtId: string, now = new Date()): Promise<FollowResult> {
  return onNote(thoughtId, async (tx, row) => {
    const msg = readFollow(row.actions).message?.data as MessageData | undefined;
    const d = msg?.draft;
    if (!msg || !d) return { ok: false, reason: 'There is no Gmail draft on this note.' };
    if (d.sentAt) return { ok: false, reason: 'It has been sent, so it cannot be taken back.' };
    if (!d.discardedAt) {
      const [acct] = await tx.select().from(gmailAccounts).where(eq(gmailAccounts.email, d.accountEmail)).limit(1);
      if (acct) {
        const { gmailService } = await import('$lib/integrations/gmail/service');
        await gmailService.deleteDraft(acct, d.id).catch(() => {});
      }
    }
    await store(tx, row, 'message', 'Message drafted', { ...msg, draft: { ...d, discardedAt: now.toISOString() } }, now);
    return { ok: true, message: 'Discarded.' };
  });
}

// ── Home Assistant: what dropped out, and a refresh ────────────────────────

async function tool(name: string, args: Record<string, unknown>) {
  const { executeTool } = await import('$lib/tools/registry');
  return executeTool(name, args);
}

/** Look now at what is unavailable. Read-only; he picks from the list. */
export async function checkHome(thoughtId: string, now = new Date()): Promise<FollowResult> {
  return onNote(thoughtId, async (tx, row) => {
    const res = await tool('ha_find', { state: 'unavailable', limit: 40, includeAttributes: false });
    if (!res?.success) return { ok: false, reason: `Home Assistant could not be read: ${String(res?.error ?? 'no reason given').slice(0, 160)}` };
    const entities = ((res.data as { entities?: Array<{ entity_id?: unknown; friendly_name?: unknown; area_name?: unknown }> } | undefined)?.entities ?? [])
      .filter((e) => typeof e.entity_id === 'string')
      .map((e) => ({ id: String(e.entity_id), name: `${String(e.friendly_name ?? e.entity_id)}${e.area_name ? ` (${String(e.area_name)})` : ''}` }));
    // Devices the note names first; the rest after.
    const noteText = `${row.title} ${row.narrative ?? ''}`.toLowerCase();
    const named = (n: string) => n.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4).some((w) => noteText.includes(w));
    entities.sort((a, b) => Number(named(b.name)) - Number(named(a.name)));
    const found = entities.slice(0, 12);
    const data: HomeData = { found, refreshed: [], refreshedAt: null };
    await store(tx, row, 'home', 'Choose what to refresh', data, now);
    return { ok: true, message: found.length ? `${found.length} device${found.length === 1 ? ' is' : 's are'} unavailable now. Pick up to ${MAX_HOME_REFRESH} to refresh.` : 'Nothing is unavailable right now.' };
  });
}

/**
 * Ask Home Assistant to refresh the chosen devices and reload their
 * integrations. Only `HOME_SERVICES`, only on devices the check found.
 */
export async function refreshHome(thoughtId: string, chosen: unknown, now = new Date()): Promise<FollowResult> {
  return onNote(thoughtId, async (tx, row) => {
    const data = readFollow(row.actions).home?.data as HomeData | undefined;
    if (!data?.found) return { ok: false, reason: 'Check what has dropped out first.' };
    const ids = pickHomeEntities(chosen, data.found);
    if (!ids.length) return { ok: false, reason: 'Pick at least one device from the list.' };
    const failed: string[] = [];
    for (const id of ids) {
      const updated = await tool('ha_call_service', { domain: 'homeassistant', service: 'update_entity', entity_id: id });
      const reloaded = await tool('ha_call_service', { domain: 'homeassistant', service: 'reload_config_entry', entity_id: id });
      if (!updated?.success && !reloaded?.success) failed.push(id);
    }
    await store(tx, row, 'home', 'Refreshed', { ...data, refreshed: ids.filter((i) => !failed.includes(i)), refreshedAt: now.toISOString() }, now);
    if (failed.length === ids.length) return { ok: false, reason: 'Home Assistant refused every refresh. They may need power or re-pairing.' };
    return { ok: true, message: failed.length ? `Asked Home Assistant to refresh ${ids.length - failed.length}; it refused ${failed.length}.` : `Asked Home Assistant to refresh ${ids.length}. Look again in a minute.` };
  });
}
