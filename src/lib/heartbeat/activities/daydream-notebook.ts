import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import { listJobs } from '$lib/workflows/chat/job-store';
import {
  attributeSpend,
  budgetStatus,
  readQuotaMark,
  ZERO_SPEND,
} from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import { executeNoteAction } from '$lib/daydream/notebook/actions';
import { reviewNote } from '$lib/daydream/notebook/review';
import {
  markReviewed,
  notesNeedingReview,
  recordExecuted,
  recordPlanned,
  recordRefused,
} from '$lib/daydream/notebook/store';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-notebook';

interface NotebookConfig {
  /** Skip a run if the owner messaged inside this window — the same
   *  spare-cycles contract the composer and the ponder engine keep. */
  idleWindowMinutes?: number;
  /** Notes per run. Small on purpose: each one is a model call plus up to
   *  three actions, and one of those actions can be a 90-second web search. */
  notesPerRun?: number;
}

const DEFAULTS: Required<NotebookConfig> = { idleWindowMinutes: 20, notesPerRun: 2 };

/**
 * Reading the notebook on dead cycles.
 *
 * The notebook is the first thing in daydreaming that John wrote rather than
 * the engine proposed, and this is what makes it more than a text file: on
 * spare cycles a model reads a note, decides whether anything would genuinely
 * help, and code executes the short list it comes back with — a quick piece of
 * research, a link to something the graph already knows, a paragraph of
 * background filed beside the note rather than inside it.
 *
 * ── The gates, in the order they matter ────────────────────────────────────
 *
 *   1. daydreaming is on at all
 *   2. no job in flight, owner not active — "spare cycles" means spare
 *   3. the budget will have it. This spends the same Codex caps as the
 *      composer and the ponder engine, and is deliberately LAST in the
 *      priority order: talking and thinking both matter more than tidying up
 *      the notebook.
 *   4. only notes that have CHANGED since their last review
 *
 * The fourth is what keeps a steady-state notebook free. Once every note has
 * been read at its current text, this activity costs one indexed query per tick
 * and returns `skipped`, forever, until John types something.
 */
export const daydreamNotebook: ActivityHandler = {
  name: NAME,
  description:
    "Reads John's notebook on spare cycles: a model looks at a note that has changed since it was last read, and plans short research, links into the knowledge graph, or supporting background. Every plan is validated against a closed vocabulary before anything runs — research is limited to the two SHORT tiers. Spends against the Codex caps.",
  defaultCadenceSeconds: 3600,
  defaultEnabled: true,
  defaultActiveHours: { start: '07:00', end: '23:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as NotebookConfig) };
    const now = new Date(ctx.now);

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) return { outcome: 'skipped', summary: 'daydreaming disabled' };

    const running = listJobs().filter((j) => j.status === 'running');
    if (running.length > 0) {
      return { outcome: 'skipped', summary: `${running.length} job(s) in flight — not spare` };
    }
    if (await isUserActive(cfg.idleWindowMinutes * 60_000)) {
      return { outcome: 'skipped', summary: 'owner active in the last few minutes' };
    }

    // Cheapest question first: is there anything to do at all? A settled
    // notebook must not cost a budget check or a quota read every hour.
    const due = await notesNeedingReview(cfg.notesPerRun);
    if (due.length === 0) {
      return { outcome: 'skipped', summary: 'no note has changed since it was last read' };
    }

    const model = await resolveDaydreamModel();
    const isCodexModel = model.provider === 'codex';
    const budget = await budgetStatus({ now, isCodexModel });
    if (budget.blocked) {
      return { outcome: 'skipped', summary: `budget: ${budget.blockedReason}`, details: { budget } };
    }

    const before = isCodexModel ? await readQuotaMark() : null;
    let promptTokens = 0;
    let completionTokens = 0;
    let reviewed = 0;
    let planned = 0;
    let executed = 0;
    let failed = 0;
    let refused = 0;
    const errors: string[] = [];

    for (const note of due) {
      try {
        // What the graph already knows that this note could point at. Supplied
        // rather than left to the model's imagination — the lead writer spent a
        // fortnight producing nothing because it was asked to choose from a
        // vocabulary it had never been shown, and an invented entity id is a
        // link that 404s.
        const knownRefs = await relatedRefs(note.title, note.body);

        const plan = await reviewNote({ ...note, knownRefs });
        promptTokens += plan.tokens.prompt;
        completionTokens += plan.tokens.completion;

        if (plan.error) {
          errors.push(`${note.id.slice(0, 8)}: ${plan.error}`);
          // NOT marked reviewed — a note whose review failed should be tried
          // again, or a transient model outage would silently skip it forever.
          continue;
        }

        for (const bad of plan.refused) {
          refused++;
          await recordRefused(note.id, bad.kind, bad.title, bad.error);
        }

        for (const action of plan.actions) {
          planned++;
          const actionId = await recordPlanned(
            note.id,
            action.kind,
            action.title,
            action.params as unknown as Record<string, unknown>,
          );
          const outcome = await executeNoteAction(note.id, action);
          await recordExecuted(actionId, outcome);
          if (outcome.ok) executed++;
          else failed++;
        }

        // Only once the plan has been carried out, so a crash mid-run leaves
        // the note due rather than silently done.
        await markReviewed(note.id, note.title, note.body);
        reviewed++;
      } catch (err) {
        errors.push(`${note.id.slice(0, 8)}: ${errMsg(err)}`);
      }
    }

    const after = isCodexModel ? await readQuotaMark() : null;
    const quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };

    const bits = [
      `${reviewed}/${due.length} notes read`,
      `${planned} actions planned, ${executed} done${failed ? `, ${failed} failed` : ''}`,
      ...(refused ? [`${refused} refused by the validator`] : []),
    ];
    if (errors.length) bits.push(`errors: ${errors.slice(0, 3).join('; ')}`);

    return {
      outcome: reviewed === 0 && errors.length ? 'error' : 'ok',
      summary: bits.join(' · '),
      promptTokens,
      completionTokens,
      details: {
        // Load-bearing: budget.ts reads this key back to enforce the caps.
        quota,
        model: model.modelId,
        reviewed,
        planned,
        executed,
        failed,
        refused,
        errors,
      },
    };
  },
};

/**
 * Entities and past research the note might be about.
 *
 * A cheap trigram/ILIKE lookup rather than an embedding search: this is picking
 * candidates for a model to judge, not answering a question, and the note has
 * already been read by the time precision would matter. Failure is soft — a
 * plan with no `link` actions is an ordinary plan.
 */
async function relatedRefs(
  title: string,
  body: string,
): Promise<Array<{ refKind: string; refId: string; label: string }>> {
  try {
    const { db } = await import('$lib/db');
    const { intelEntities, researchSessions } = await import('$lib/db/schema');
    const { desc, ilike, or, sql } = await import('drizzle-orm');

    // The words worth matching on: long enough to be a name, capped so one
    // long note does not build a hundred-clause query.
    const terms = [...new Set(`${title} ${body}`.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? [])]
      .slice(0, 8);
    if (terms.length === 0) return [];

    const [entities, research] = await Promise.all([
      db
        .select({ id: intelEntities.id, name: intelEntities.canonicalName })
        .from(intelEntities)
        .where(or(...terms.map((t) => ilike(intelEntities.canonicalName, `%${t}%`))))
        .orderBy(desc(intelEntities.updatedAt))
        .limit(15),
      db
        .select({ id: researchSessions.id, topic: researchSessions.topic })
        .from(researchSessions)
        .where(
          sql`${researchSessions.status} = 'complete' and (${or(
            ...terms.map((t) => ilike(researchSessions.topic, `%${t}%`)),
          )})`,
        )
        .orderBy(desc(researchSessions.createdAt))
        .limit(10),
    ]);

    return [
      // `canonicalName` is nullable on the column. An entity with no name is
      // useless as a link candidate — the model would be choosing blind — so it
      // is dropped rather than offered as an empty label.
      ...entities
        .filter((e): e is { id: string; name: string } => typeof e.name === 'string' && e.name.length > 0)
        .map((e) => ({ refKind: 'intel-entity', refId: e.id, label: e.name })),
      ...research.map((r) => ({ refKind: 'research', refId: r.id, label: `past research: ${r.topic}` })),
    ];
  } catch {
    return [];
  }
}
