import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/heartbeat/idle';
import { listChatJobs } from '$lib/jkai/chat/activity';
import { quotaGuard, type Depth } from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/model';
import { runThink } from '$lib/daydream/think/run';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import { itemText } from '$lib/daydream/mail-room';
import { queueBuildNotes } from './daydream-think';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-mail';

interface MailConfig {
  /** Skip a run if the owner messaged inside this window. */
  idleWindowMinutes?: number;
  /** Backlog rows looked at in one cycle. */
  batch?: number;
}

const DEFAULTS: Required<MailConfig> = { idleWindowMinutes: 20, batch: 12 };

/** The items are already on cards, so the rounds are for checking, not finding. */
const ROUNDS_BY_DEPTH: Record<Depth, number> = { minimal: 2, standard: 3, deep: 4 };

/**
 * The mail backlog drain — what his mail, calendar and documents say, a dozen
 * items at a time.
 *
 * SR-Jkai-Core reads each thread, entry and document once and stores FACTS
 * (`source_backlog`, spec 2026-11-15-source-backlog). This activity takes the
 * unconsidered rows that still have something ahead of them, puts them in
 * front of a think cycle as cards, and records what came of each: a note,
 * nothing, or — without a model call — "reachable in aggregate only". The
 * message itself is never read here.
 *
 * A note reaches his phone only when its item is time-critical
 * (`timeCritical`), inside the same daily allowance as every other daydream
 * note; the rest wait in the Mail room and the Sunday digest.
 *
 * Spends the same Codex caps as the think loop — in `SPENDING_ACTIONS`, and
 * `details.quota` below is load-bearing.
 */
export const daydreamMail: ActivityHandler = {
  name: NAME,
  description:
    'The mail backlog drain: on spare cycles, up to a dozen unconsidered backlog items — facts extracted from mail, calendar and documents, never the content — go in front of a think cycle with the private read-only tool set. At most two cited notes; only time-critical ones interrupt, the rest wait in the Mail room. Spends against the Codex caps.',
  defaultCadenceSeconds: 30 * 60,
  defaultEnabled: true,
  defaultActiveHours: { start: '07:00', end: '23:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as MailConfig) };
    const now = new Date(ctx.now);

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    // Spare cycles means spare — the think loop's two gates.
    const running = (await listChatJobs()).filter((j) => j.status === 'running');
    if (running.length > 0) {
      return { outcome: 'skipped', summary: `${running.length} job(s) in flight — not spare` };
    }
    if (await isUserActive(cfg.idleWindowMinutes * 60_000)) {
      return { outcome: 'skipped', summary: 'owner active in the last few minutes' };
    }

    // Filing rows as aggregate-only is queries, not spend, so it happens
    // before the budget is asked: a thin budget still shortens the queue.
    const { drainBatch, markConsidered } = await import('$lib/daydream/mail-room.server');
    let batch;
    try {
      batch = await drainBatch(now, Math.max(1, Math.min(20, cfg.batch)));
    } catch (err) {
      // The table is created by hand at release; before that there is nothing to drain.
      return { outcome: 'skipped', summary: `backlog not readable: ${errMsg(err).slice(0, 120)}` };
    }
    const filedBit = batch.filed ? ` · ${batch.filed} filed without a look` : '';
    if (batch.items.length === 0) {
      return { outcome: 'skipped', summary: `nothing waiting${filedBit}`, details: { filed: batch.filed } };
    }

    const model = await resolveDaydreamModel();
    const guard = quotaGuard({ action: NAME, isCodexModel: model.provider === 'codex', now });
    const verdict = await guard.check();
    const budget = verdict.status;
    if (!verdict.allowed) {
      return { outcome: 'skipped', summary: `budget: ${verdict.reason}${filedBit}`, details: { budget, filed: batch.filed } };
    }

    let backlog: string[] = [];
    try {
      const { listBacklog } = await import('$lib/selfimprove/backlog');
      backlog = (await listBacklog()).filter((i) => i.status === 'open').map((i) => i.title).slice(0, 25);
    } catch {
      backlog = [];
    }

    await guard.begin();
    let result;
    try {
      result = await runThink({
        now,
        maxRounds: ROUNDS_BY_DEPTH[budget.plan.depth],
        backlog,
        drain: { items: batch.items.map((i) => ({ id: i.id, text: itemText(i), critical: i.critical })) },
      });
    } catch (err) {
      return { outcome: 'error', summary: errMsg(err) };
    }
    const quota = await guard.end();

    // A model that never answered looked at nothing: the rows stay queued.
    // One that answered badly did look, and asking again would loop on it.
    const looked = !(result.error && result.rounds === 0);
    if (looked) {
      const noted = new Set<string>();
      for (const d of result.drained ?? []) {
        await markConsidered(d.itemIds, 'note', now, d.thoughtId);
        d.itemIds.forEach((id) => noted.add(id));
      }
      await markConsidered(batch.items.map((i) => i.id).filter((id) => !noted.has(id)), 'nothing', now);
    }

    let queued = { added: 0, merged: 0 };
    try {
      queued = await queueBuildNotes(result.notes.createdKeys ?? []);
    } catch (err) {
      console.error(`[daydream] build notes not queued: ${errMsg(err)}`);
    }

    const n = result.notes;
    const urgent = batch.items.filter((i) => i.critical).length;
    const bits = [
      `${batch.items.length} item${batch.items.length === 1 ? '' : 's'}${urgent ? ` (${urgent} time-critical)` : ''}`,
      ...(batch.filed ? [`${batch.filed} filed without a look`] : []),
      `${result.toolCalls} tool call${result.toolCalls === 1 ? '' : 's'}${result.toolFailures ? ` (${result.toolFailures} failed)` : ''}`,
      `${n.proposed} note${n.proposed === 1 ? '' : 's'} (${n.created} new${n.merged ? `, ${n.merged} merged` : ''}${n.suppressed ? `, ${n.suppressed} held` : ''})`,
      ...(result.notified ? [`${result.notified} sent`] : []),
      ...(result.acted ? [`${result.acted} done by itself`] : []),
      ...(result.quiet ? [`${result.quiet} kept for the Mail room`] : []),
      ...(result.untold ? [`${result.untold} done but NOT told (push failed)`] : []),
      ...(queued.added || queued.merged ? [`backlog +${queued.added}${queued.merged ? ` (${queued.merged} merged)` : ''}`] : []),
      // The fabrication meter. Always reported — a quiet audit is a claim.
      `audit dropped ${result.rejected.length}`,
      ...(looked ? [] : ['rows left queued']),
    ];
    if (result.error) bits.push(`error: ${result.error}`);

    return {
      outcome: result.error && n.proposed === 0 ? 'error' : 'ok',
      summary: bits.join(' · '),
      details: {
        // Load-bearing: budget.ts reads this key back to enforce the caps.
        quota,
        depth: budget.plan.depth,
        model: model.modelId,
        ...result,
        items: batch.items.length,
        filed: batch.filed,
        backlog: queued,
      },
    };
  },
};
