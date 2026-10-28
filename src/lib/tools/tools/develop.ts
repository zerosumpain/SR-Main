// Commissioning a build from web chat (overhaul plan 2026-10-28, point 5,
// slice 6b): the `develop` toolset.
//
// - develop_quote (read): the confirmation card's facts, true now.
// - develop_commission: lane 'commission', confirm 'always'. Opened ONLY by
//   JKAI_INVOKE_COMMISSION_TOKEN on /api/platform/tools/invoke AND a sealed
//   owner principal attended in a browser session ('session'); refused to the
//   bridge, heartbeat, WhatsApp, the service turn, Siri, Watch and a paired
//   phone (no proof of presence yet), and closed to every in-process caller.
// - develop_status (read): one delivery, or the commissioned ones.
//
// `request_change` is an alias of develop_commission now (decision 6), on the
// same lane and gate, and goes a fortnight after this ships.
//
// Owner-only throughout: none of these is member-safe or on any unattended
// caller's list.

import { register } from '../registry-internal';
import type { ToolExecContext, ToolResult } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiBuildDeliveries, jkaiBuilds } from '$lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { PRODUCT_AREAS } from '$lib/constants/development';
import type { DeliveryState, ReleasePolicy } from '$lib/constants/development';
import { CHAT_RELEASE_POLICIES, deliveryFacts } from '$lib/jkai/commission/commission';
import { refuseUnlessOwner } from './owner-only';

// `goal` is the label the watcher's note opens with (heartbeat/handlers/targeted.ts).
const DELIVERY_WATCH = { kind: 'delivery', idPath: 'buildId', cadenceSeconds: 120, goal: 'Commissioned build' } as const;

function policyArg(v: unknown): ReleasePolicy | 'invalid' {
  if (v === undefined || v === null || v === '') return 'preview_only';
  return typeof v === 'string' && (CHAT_RELEASE_POLICIES as readonly string[]).includes(v) ? (v as ReleasePolicy) : 'invalid';
}

const RELEASE_POLICY_PARAM = {
  type: 'string',
  enum: [...CHAT_RELEASE_POLICIES],
  description: "Where the build stops: 'preview_only' (default — a working preview, nothing proposed) or 'pull_request' (a DRAFT pull request; never merged or shipped by this). Production is not available from chat.",
};

register({
  name: 'develop_quote',
  description:
    'What commissioning a build would cost, said plainly, before asking John: the repository (SR-Main), where it stops (preview only, or a draft pull request), the budget ("up to 25 rounds, 2 hours, $2"), the ChatGPT quota now, and how many commissioned builds are already running. Returns `refusal` when a commission would be refused right now (quota too full, two already running). Read-only.',
  parameters: {
    type: 'object',
    properties: {
      outcome: { type: 'string', description: 'The intended outcome, as it will appear on the card. Optional.' },
      releasePolicy: RELEASE_POLICY_PARAM,
    },
    required: [],
  },
  category: 'Develop',
  toolset: 'develop',
  surfaces: ['chat'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('develop_quote', ctx);
    if (refused) return refused;
    const releasePolicy = policyArg(args.releasePolicy);
    if (releasePolicy === 'invalid') return { success: false, error: "releasePolicy must be 'preview_only' or 'pull_request'." };
    const { quoteCommission } = await import('$lib/jkai/commission/commission.server');
    const quote = await quoteCommission({ releasePolicy, outcome: typeof args.outcome === 'string' ? args.outcome : undefined });
    return { success: true, data: quote };
  },
});

/** develop_commission and the request_change alias share this. */
async function commission(
  name: string,
  input: { outcome: string; releasePolicy: unknown; area?: unknown; autopilot?: unknown; criteria?: unknown; operationKey?: unknown },
  ctx?: ToolExecContext,
): Promise<ToolResult> {
  const refused = refuseUnlessOwner(name, ctx);
  if (refused) return refused;
  const releasePolicy = policyArg(input.releasePolicy);
  if (releasePolicy === 'invalid') {
    return { success: false, error: "From chat a build stops at 'preview_only' or 'pull_request' (a draft). Shipping to production is on the New feature form at /jkai/develop." };
  }
  const { commissionBuild } = await import('$lib/jkai/commission/commission.server');
  const result = await commissionBuild({
    source: 'chat',
    principal: ctx?.principal,
    outcome: input.outcome,
    area: typeof input.area === 'string' && (PRODUCT_AREAS as readonly string[]).includes(input.area) ? input.area : undefined,
    releasePolicy,
    autopilot: input.autopilot === false ? false : true,
    criteria: Array.isArray(input.criteria) ? input.criteria.filter((c): c is string => typeof c === 'string') : undefined,
    conversationId: ctx?.conversationId,
    surface: ctx?.surface,
    operationKey: typeof input.operationKey === 'string' && input.operationKey ? input.operationKey : undefined,
    pinnedModelId: ctx?.modelContext?.modelId || undefined,
  });
  if (!result.ok) return { success: false, error: result.reason };
  return {
    success: true,
    data: {
      buildId: result.buildId,
      href: result.href,
      deepLink: result.deepLink,
      reused: result.reused,
      started: result.started,
      note: result.note,
    },
  };
}

register({
  name: 'develop_commission',
  effect: 'mutate',
  confirm: 'always',
  lane: 'commission',
  description:
    'Commission a build of the Strange Ramblings site itself (SR-Main): a /jkai/develop delivery with a brief, acceptance criteria, an independent assessor and autopilot, running in the builder sidecar. John confirms a card first (repository, where it stops, "up to 25 rounds, 2 hours, $2", the ChatGPT quota now). Stops at a working preview, or a DRAFT pull request; never merges or ships. Progress comes back into this thread at each stage. ' +
    'Use for a change that needs code in the repo — a page, a route, a component, a schema change, a new node type, a bug fix. For a self-contained app use build_create (an app build); for a one-off page use publish_page; for a new tool try author_ephemeral_tool first. ' +
    'Only from /jkai in a browser: refused on WhatsApp, the phone, Siri, Watch and any background run. The same ask in the same thread returns the same delivery.',
  parameters: {
    type: 'object',
    properties: {
      outcome: {
        type: 'string',
        description: "The intended outcome in John's own words, plus any constraints or context. The first line is the title. Becomes the brief's outcome.",
      },
      releasePolicy: RELEASE_POLICY_PARAM,
      area: { type: 'string', enum: [...PRODUCT_AREAS], description: "The product area. Defaults to 'Platform'." },
      autopilot: { type: 'boolean', description: 'Default true: the builder grooms, builds and reviews on its own. False leaves the brief for John at /jkai/develop.' },
      criteria: { type: 'array', items: { type: 'string' }, description: 'Optional acceptance criteria; grooming proposes them otherwise.' },
      operationKey: { type: 'string', description: 'Optional idempotency key (8-200 of A-Z a-z 0-9 _.:-). Absent: the thread plus the outcome.' },
    },
    required: ['outcome'],
  },
  category: 'Develop',
  toolset: 'develop',
  surfaces: ['chat'],
  producesLongRunningTask: { ...DELIVERY_WATCH },
  handler: async (args, ctx) =>
    commission('develop_commission', {
      outcome: typeof args.outcome === 'string' ? args.outcome : '',
      releasePolicy: args.releasePolicy,
      area: args.area,
      autopilot: args.autopilot,
      criteria: args.criteria,
      operationKey: args.operationKey,
    }, ctx),
});

register({
  name: 'request_change',
  effect: 'mutate',
  confirm: 'always',
  lane: 'commission',
  description:
    'DEPRECATED alias of develop_commission — use that. Commissions a build of the site (SR-Main) that stops at a DRAFT pull request; never merges or ships. Same confirmation card and the same rules: only from /jkai in a browser.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short outcome, e.g. "Add a /projects/tide-times page". The first line of the brief.' },
      request: { type: 'string', description: "The full request in John's own words, with any constraints or criteria." },
      labels: { type: 'array', items: { type: 'string' }, description: 'Ignored; kept so old calls still validate.' },
    },
    required: ['title', 'request'],
  },
  category: 'Develop',
  toolset: 'builds',
  surfaces: ['chat'],
  producesLongRunningTask: { ...DELIVERY_WATCH },
  handler: async (args, ctx) => {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    const request = typeof args.request === 'string' ? args.request.trim() : '';
    if (!title || !request) return { success: false, error: 'Both `title` and `request` are required.' };
    return commission('request_change', { outcome: `${title}\n\n${request}`, releasePolicy: 'pull_request' }, ctx);
  },
});

type Row = { buildId: string; title: string | null; status: string; outcome: string | null; costUsd: string | null; state: DeliveryState };

function statusOf(r: Row) {
  const f = deliveryFacts(r.state, r.outcome);
  return {
    buildId: r.buildId,
    title: r.title,
    href: `/jkai/develop/${r.buildId}`,
    stage: f.stageWord,
    criteria: `${f.criteria.met} of ${f.criteria.total} met`,
    previewUrl: f.previewUrl,
    prUrl: f.prUrl,
    awaitingOwner: f.awaitingOwner,
    stopReason: f.stopReason,
    live: !f.terminal,
    releasePolicy: r.state.releasePolicy,
    costUsdSoFar: r.costUsd === null ? null : Number(r.costUsd),
    commissionedFrom: r.state.commission?.source ?? null,
  };
}

register({
  name: 'develop_status',
  description:
    'Where a commissioned build (a /jkai/develop delivery) has got to: stage, criteria met, preview link, pull request link, whether it is waiting on John, and cost so far. Pass buildId for one; omit it for the commissioned deliveries, live ones first. Read-only.',
  parameters: {
    type: 'object',
    properties: { buildId: { type: 'string', description: 'The delivery (build) id. Omit for the list.' } },
    required: [],
  },
  category: 'Develop',
  toolset: 'develop',
  surfaces: ['chat'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('develop_status', ctx);
    if (refused) return refused;
    const select = {
      buildId: jkaiBuildDeliveries.buildId,
      title: jkaiBuilds.title,
      status: jkaiBuilds.status,
      outcome: jkaiBuilds.outcome,
      costUsd: jkaiBuilds.costUsd,
      state: jkaiBuildDeliveries.state,
    };
    if (typeof args.buildId === 'string' && args.buildId.trim()) {
      const id = args.buildId.trim();
      if (!/^[0-9a-f-]{36}$/i.test(id)) return { success: false, error: 'buildId must be a delivery id.' };
      const [row] = await db.select(select).from(jkaiBuildDeliveries).innerJoin(jkaiBuilds, eq(jkaiBuilds.id, jkaiBuildDeliveries.buildId))
        .where(eq(jkaiBuildDeliveries.buildId, id)).limit(1);
      if (!row) return { success: false, error: `No delivery ${id}.` };
      return { success: true, data: statusOf(row as unknown as Row) };
    }
    const rows = await db.select(select).from(jkaiBuildDeliveries).innerJoin(jkaiBuilds, eq(jkaiBuilds.id, jkaiBuildDeliveries.buildId))
      .where(sql`${jkaiBuildDeliveries.state}->>'commissioned' IS DISTINCT FROM 'false'`)
      .orderBy(desc(jkaiBuildDeliveries.updatedAt)).limit(20);
    const list = (rows as unknown as Row[]).map(statusOf).sort((a, b) => Number(b.live) - Number(a.live));
    return { success: true, data: { deliveries: list, live: list.filter((d) => d.live).length } };
  },
});
