/**
 * Commissioning a development delivery — the one way a feature enters
 * `/jkai/develop`.
 *
 * Two callers: the owner's "New feature" form (`POST /api/jkai/development`)
 * and the nightly improvement engine, which hands an owner-accepted backlog
 * brief here instead of opening a change request (via the injected lane in
 * `$lib/heartbeat/build-lanes`). Both get the same paused build, the same
 * budget and the same delivery state, so a backlog item is reviewed, previewed
 * and released exactly like a feature somebody typed in.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { jkaiBuildDeliveries, jkaiBuilds } from '$lib/db/schema';
import type { DeliveryState, ReleasePolicy } from '$lib/constants/development';
import { SR_MAIN_GIT_TARGET } from './git-targets';
import { CHANGE_REQUEST_BUDGET } from './change-request';
import { resolveDevelopmentModel } from './development-models.server';
import { ensureDelivery, mutateDelivery } from './development-state.server';

/** Brief fields a caller may carry in from an already-groomed source. */
export type ImportedBrief = Partial<Pick<DeliveryState['brief'], 'constraints' | 'scope' | 'dependencies' | 'assumptions' | 'questions' | 'validation' | 'routes' | 'newRoutes' | 'lane'>>;

export interface CreateDeliveryInput {
  /** The intended outcome. Becomes the build prompt and the brief's outcome. */
  outcome: string;
  area: string;
  title?: string;
  releasePolicy?: ReleasePolicy;
  autopilot?: boolean;
  maxRounds?: number;
  /** A catalogue model id; absent means the `builder` workload's model. */
  modelId?: unknown;
  criteria?: string[];
  brief?: ImportedBrief;
  /** The grooming that produced `brief`, when it was groomed elsewhere — the
   *  backlog's groomed brief is a development brief, so it is not groomed twice. */
  grooming?: DeliveryState['grooming'];
  /** The improvement-backlog item this delivers, when it came from one. */
  backlogSlug?: string;
}

/** The model id was not in the catalogue — the caller's mistake, not a fault. */
export class DevelopmentModelChoiceError extends Error {}

/**
 * Create the paused build and its delivery. Validation of a person's form
 * stays in the route; this throws only when the model cannot be resolved or
 * the database refuses.
 */
export async function createDevelopmentDelivery(input: CreateDeliveryInput): Promise<{ buildId: string }> {
  let model;
  try { model = await resolveDevelopmentModel(input.modelId); }
  catch (e) { throw new DevelopmentModelChoiceError((e as Error).message); }
  const outcome = input.outcome.trim();
  const [build] = await db.insert(jkaiBuilds).values({
    title: (input.title?.trim() || outcome.split('\n')[0]).slice(0, 100), prompt: outcome, status: 'paused',
    origin: 'manual', planStatus: 'approved',
    gitTargetConfig: { ...SR_MAIN_GIT_TARGET, openPr: false, ...(input.backlogSlug ? { backlogSlug: input.backlogSlug } : {}) },
    budgetConfig: { ...CHANGE_REQUEST_BUDGET }, modelProvider: model.provider, modelId: model.modelId,
  }).returning();
  await ensureDelivery(build.id, input.area, input.criteria ?? [], {
    commissioned: true,
    releasePolicy: input.releasePolicy ?? 'preview_only',
    autopilot: input.autopilot === true,
    maxRounds: input.maxRounds,
  });
  const extras = Object.fromEntries(Object.entries(input.brief ?? {}).filter(([, v]) => typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.length : v != null));
  if (Object.keys(extras).length || input.grooming) {
    await mutateDelivery(build.id, input.backlogSlug ? 'brief_imported_from_backlog' : 'brief_imported', (s) => ({ ...s, brief: { ...s.brief, ...extras },
      ...(input.grooming ? { grooming: input.grooming } : {}) }));
  }
  return { buildId: build.id };
}

/** What the backlog dedup reads from a delivery. */
export interface BacklogDeliveryRow {
  buildId: string;
  outcome: string | null;
  state: Pick<DeliveryState, 'stage' | 'autopilot'>;
}

/**
 * The delivery still answering a backlog item, or null. PURE.
 *
 * Live means not yet serving and not stopped — by its autopilot or by the
 * owner. A stopped or shipped delivery is history; a re-opened backlog item
 * after that is a new request.
 */
export function liveBacklogDelivery(rows: readonly BacklogDeliveryRow[]): BacklogDeliveryRow | null {
  return rows.find((r) => r.state.stage !== 'deployed' && !r.state.autopilot?.stopReason && r.outcome !== 'stopped_by_user') ?? null;
}

/** Read the deliveries recorded against a backlog slug and match. Soft on a
 *  read failure, like the change-request dedup it replaces: a lookup that
 *  cannot run must not lose the ask. */
export async function findBacklogDelivery(backlogSlug: string): Promise<BacklogDeliveryRow | null> {
  try {
    const rows = await db.select({ buildId: jkaiBuilds.id, outcome: jkaiBuilds.outcome, state: jkaiBuildDeliveries.state })
      .from(jkaiBuildDeliveries).innerJoin(jkaiBuilds, eq(jkaiBuilds.id, jkaiBuildDeliveries.buildId))
      .where(sql`${jkaiBuilds.gitTargetConfig}->>'backlogSlug' = ${backlogSlug}`)
      .orderBy(desc(jkaiBuilds.createdAt)).limit(20);
    return liveBacklogDelivery(rows as BacklogDeliveryRow[]);
  } catch (err) {
    console.warn(`[development] backlog delivery lookup failed, creating a new one: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
