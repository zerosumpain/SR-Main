/**
 * Commissioning a build: the one entry point into /jkai/develop from chat.
 *
 * Intake, then delivery, then the builder sidecar — never the in-process
 * orchestrator. The rules it applies are in `./commission` (PURE); this file
 * is the order of work and the reads and writes:
 *
 *  1. refuse what may not commission (unattended callers except the nightly
 *     lane, 'production' outside the web form, any target but SR-Main);
 *  2. the same operationKey returns the same delivery;
 *  3. the ChatGPT quota ceiling, and at most two live commissions;
 *  4. intake on the improvement backlog (source 'chat'), so a chat ask dedupes
 *     against daydream and backlog items and a live delivery is reused;
 *  5. the delivery, on the owner-pinned model or the builder workload's;
 *  6. `state.commission` records who asked (JSON: no column, no GRANT);
 *  7. with autopilot on, the sidecar's sweep takes it from here. The builder
 *     is asked whether it can, so a dead worker is said, not discovered later.
 *
 * Overhaul plan 2026-10-28, point 5 / slice 6b.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations, jkaiBuildDeliveries, jkaiBuilds } from '$lib/db/schema';
import type { CommissionSource, DeliveryState, ReleasePolicy } from '$lib/constants/development';
import { PRODUCT_AREAS } from '$lib/constants/development';
import type { ToolPrincipal } from '$lib/tools/invoke-contract';
import { CHANGE_REQUEST_BUDGET } from '../change-request';
import { normaliseConversationId } from '../conversation-id';
import { createDevelopmentDelivery, DevelopmentModelChoiceError, findBacklogDelivery } from '../development-create.server';
import { mutateDelivery } from '../development-state.server';
import { commissionPorts } from './ports';
import { builderClient } from '../builder-client';
import {
  commissionRefusal,
  deliveryTerminal,
  liveCapRefusal,
  OPERATION_KEY_PATTERN,
  quoteCard,
  quotaRefusal,
  type CommissionTarget,
} from './commission';

export interface CommissionInput {
  source: CommissionSource;
  principal: ToolPrincipal | undefined;
  outcome: string;
  area?: string;
  target?: CommissionTarget | string;
  releasePolicy?: ReleasePolicy;
  autopilot?: boolean;
  criteria?: string[];
  conversationId?: string;
  surface?: string;
  refs?: Array<{ kind: string; id: string }>;
  /** Absent: derived from the thread and the outcome, so a retry is the same ask. */
  operationKey?: string;
  /** The owner-pinned model id for the thread, when there is one. */
  pinnedModelId?: string;
}

export type CommissionResult =
  | {
      ok: true;
      buildId: string;
      href: string;
      deepLink: string;
      reused: boolean;
      /** False when the builder could not be reached; the delivery waits. */
      started: boolean;
      note: string;
    }
  | { ok: false; reason: string };

export interface CommissionQuote {
  target: 'SR-Main';
  releasePolicy: ReleasePolicy;
  stopsAt: string;
  budget: { maxIterations: number; maxTotalMinutes: number; maxCostUsd: number };
  quota: { fiveHourPct: number; weeklyPct: number } | null;
  liveCommissions: number;
  lines: string[];
  card: string;
  refusal: string | null;
}

const BUDGET = {
  maxIterations: CHANGE_REQUEST_BUDGET.maxIterations,
  maxTotalMinutes: CHANGE_REQUEST_BUDGET.maxTotalMinutes,
  maxCostUsd: CHANGE_REQUEST_BUDGET.maxCostUsd,
};

/** Calls in flight in this process, by key, so a double-send shares one. */
const inFlight = new Map<string, Promise<CommissionResult>>();

/** The ChatGPT windows now, or null; never throws. */
async function quotaMark(): Promise<{ fiveHourPct: number; weeklyPct: number } | null> {
  try {
    return await commissionPorts().quotaMark();
  } catch {
    return null;
  }
}

/** Commissioned deliveries that have not settled (`deliveryTerminal`). */
export async function liveCommissionCount(): Promise<number> {
  const rows = await db
    .select({ state: jkaiBuildDeliveries.state, outcome: jkaiBuilds.outcome })
    .from(jkaiBuildDeliveries)
    .innerJoin(jkaiBuilds, eq(jkaiBuilds.id, jkaiBuildDeliveries.buildId))
    .where(sql`${jkaiBuildDeliveries.state} ? 'commission' AND ${jkaiBuildDeliveries.state}->'commission'->>'source' <> 'selfimprove'`)
    .orderBy(desc(jkaiBuildDeliveries.updatedAt))
    .limit(50);
  return rows.filter((r) => !deliveryTerminal(r.state as DeliveryState, r.outcome)).length;
}

/** What the confirmation card says, true at the moment it is asked. */
export async function quoteCommission(input: { releasePolicy?: ReleasePolicy; outcome?: string } = {}): Promise<CommissionQuote> {
  const releasePolicy = input.releasePolicy ?? 'preview_only';
  const [quota, liveCommissions] = await Promise.all([quotaMark(), liveCommissionCount().catch(() => 0)]);
  const { lines, card, refusal } = quoteCard({ outcome: input.outcome, releasePolicy, budget: BUDGET, mark: quota, live: liveCommissions });
  return {
    target: 'SR-Main',
    releasePolicy,
    stopsAt: releasePolicy === 'pull_request' ? 'Draft pull request' : releasePolicy === 'production' ? 'Ship to production' : 'Preview only',
    budget: BUDGET,
    quota,
    liveCommissions,
    lines,
    card,
    refusal,
  };
}

/** The idempotency key for an ask with none: the thread plus the words. */
export function derivedOperationKey(conversationId: string | undefined, outcome: string): string {
  const words = outcome.trim().toLowerCase().replace(/\s+/g, ' ');
  const hash = createHash('sha256').update(`${conversationId ?? 'no-thread'}\n${words}`).digest('hex').slice(0, 24);
  return `chat:${hash}`;
}

/** The delivery a key already made, and whether its start failed, or null. */
async function deliveryForKey(operationKey: string): Promise<{ buildId: string; startError: string | null } | null> {
  const [row] = await db
    .select({ buildId: jkaiBuildDeliveries.buildId, startError: sql<string | null>`${jkaiBuildDeliveries.state}->'commission'->>'startError'` })
    .from(jkaiBuildDeliveries)
    .where(sql`${jkaiBuildDeliveries.state}->'commission'->>'operationKey' = ${operationKey}`)
    .limit(1);
  return row ? { buildId: row.buildId, startError: row.startError ?? null } : null;
}

/** The owner's thread, normalised, if it exists; anything else is dropped. */
async function ownerThread(raw: string | undefined): Promise<string | undefined> {
  if (!raw) return undefined;
  const id = normaliseConversationId(raw);
  try {
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.principalId, 'owner')))
      .limit(1);
    return row?.id;
  } catch {
    return undefined;
  }
}

function links(buildId: string) {
  return { href: `/jkai/develop/${buildId}`, deepLink: `sr://develop/${buildId}` };
}

export async function commissionBuild(input: CommissionInput): Promise<CommissionResult> {
  const outcome = (input.outcome ?? '').trim();
  if (!outcome || outcome.length > 20000) return { ok: false, reason: 'Describe the intended outcome (up to 20,000 characters).' };
  const releasePolicy = input.releasePolicy ?? 'preview_only';
  const target = input.target ?? 'sr-main';
  const refused = commissionRefusal({ source: input.source, principal: input.principal, releasePolicy, target });
  if (refused) return { ok: false, reason: refused };
  const area = input.area && (PRODUCT_AREAS as readonly string[]).includes(input.area) ? input.area : 'Platform';

  const conversationId = await ownerThread(input.conversationId);
  const operationKey = input.operationKey ?? derivedOperationKey(conversationId ?? input.conversationId, outcome);
  if (!OPERATION_KEY_PATTERN.test(operationKey)) return { ok: false, reason: 'The operation key must be 8-200 letters, digits or _.:-' };

  const running = inFlight.get(operationKey);
  if (running) return running;
  const work = (async (): Promise<CommissionResult> => {
    // (2) Idempotency, before anything is counted or spent.
    const existing = await deliveryForKey(operationKey);
    if (existing) {
      return {
        ok: true,
        buildId: existing.buildId,
        ...links(existing.buildId),
        reused: true,
        started: !existing.startError,
        note: existing.startError
          ? `Already commissioned with this key; this is the same delivery. When it was commissioned: ${existing.startError}`
          : 'Already commissioned with this key; this is the same delivery.',
      };
    }

    // (3) Cost guards. The nightly lane keeps its own one-a-night cap.
    const mark = await quotaMark();
    if (input.source !== 'selfimprove') {
      const tooFull = quotaRefusal(mark);
      if (tooFull) return { ok: false, reason: tooFull };
      const capped = liveCapRefusal(await liveCommissionCount());
      if (capped) return { ok: false, reason: capped };
    }

    // (4) Intake. Soft: a backlog that cannot be written must not lose the ask.
    let backlogSlug: string | undefined;
    if (input.source === 'chat' || input.source === 'phone') {
      try {
        const title = outcome.split('\n')[0].slice(0, 200);
        const result = await commissionPorts().intake({
          title,
          // Quoted as data: the ask, in his words, is the record, not a brief
          // for the engine to rewrite.
          detail: `Commissioned from ${input.source}: "${outcome.slice(0, 1800)}"`,
          kind: 'feature',
          priority: 2,
          source: input.source,
          ref: conversationId ? `conversation:${conversationId}` : `commission:${operationKey}`,
        });
        backlogSlug = result.slug;
      } catch (err) {
        console.warn(`[commission] backlog intake failed, commissioning anyway: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (backlogSlug) {
        const live = await findBacklogDelivery(backlogSlug);
        if (live) {
          return { ok: true, buildId: live.buildId, ...links(live.buildId), reused: true, started: true, note: 'That is already in development; this is the delivery working on it.' };
        }
      }
    }

    // (5)-(6) The delivery, with the commission written onto its state.
    const commission = {
      source: input.source,
      ...(input.surface ? { surface: input.surface } : {}),
      ...(conversationId ? { conversationId } : {}),
      operationKey,
      requestedBy: 'owner' as const,
      at: new Date().toISOString(),
      quotaAtStart: mark,
      ...(input.refs?.length ? { refs: input.refs.slice(0, 5) } : {}),
    };
    const base = {
      outcome,
      area,
      releasePolicy,
      autopilot: input.autopilot !== false,
      criteria: input.criteria?.filter((c) => c.trim()).slice(0, 30),
      backlogSlug,
      origin: input.source === 'chat' ? ('chat' as const) : ('manual' as const),
      conversationId,
      commission,
    };
    let buildId: string;
    try {
      ({ buildId } = await createDevelopmentDelivery({ ...base, modelId: input.pinnedModelId }));
    } catch (e) {
      // A pinned chat model the builder cannot use falls back to the builder
      // workload's, rather than refusing the ask.
      if (!(e instanceof DevelopmentModelChoiceError) || input.pinnedModelId === undefined) throw e;
      ({ buildId } = await createDevelopmentDelivery(base));
    }

    // (7) The sidecar drives it. Asked, so a dead worker is said now.
    let started = true;
    let note =
      base.autopilot
        ? 'Commissioned. The builder grooms the brief and builds it; progress comes back to this thread.'
        : 'Commissioned with autopilot off: the brief waits for you at /jkai/develop.';
    if (base.autopilot) {
      const reason = await builderClient
        .developmentCapabilities()
        .then((c) => (c?.persistentSessions && c.brokerConfigured ? null : 'The builder is up but its development worker is not ready.'))
        .catch((err: unknown) => `The builder sidecar could not be reached (${String(err instanceof Error ? err.message : err).slice(0, 160)}).`);
      if (reason) {
        started = false;
        note = `${reason} The delivery is saved at the brief, and autopilot picks it up when the builder is back.`;
        await mutateDelivery(buildId, 'commission_start_failed', (s) => ({
          ...s,
          ...(s.commission ? { commission: { ...s.commission, startError: reason } } : {}),
        })).catch(() => {});
      }
    }
    return { ok: true, buildId, ...links(buildId), reused: false, started, note };
  })();
  inFlight.set(operationKey, work);
  try {
    return await work;
  } finally {
    inFlight.delete(operationKey);
  }
}
