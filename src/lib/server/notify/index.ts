/**
 * One way to tell the owner something.
 *
 * Before this there were several, and they all ended in the same place: build
 * a string, call `getWhatsAppService().sendMessage(ownerPhone(), …)`, hope. The
 * intel engine does it, run outcomes do it, the escalation hook does it.
 * `$lib/server/push.ts` — the function whose NAME says notification — is two
 * empty bodies left behind when web push was retired, so anything that called
 * it has been notifying nobody for months.
 *
 * `notifyOwner` replaces that with a ledger and a routing table:
 *
 *   1. the category's route decides which channels are open,
 *   2. the category's floor and the dedupe key decide whether to raise at all,
 *   3. the row is written,
 *   4. WhatsApp is attempted if routed, and stamps its own column,
 *   5. the phone collects what is routed native, on its next background refresh.
 *
 * Step 3 happens before step 4 on purpose. A WhatsApp send can fail — the
 * bridge logs out roughly monthly — and an alert that exists only in a failed
 * send is an alert nobody will ever see.
 *
 * **This function never throws.** Every caller is already handling something
 * else going wrong.
 */

import { and, desc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '$lib/db';
import { notificationEvents, notificationRoutes } from '$lib/db/schema';
import { categoryOf, NOTIFICATION_CATEGORIES, type NotificationCategory } from './categories';
import { notificationChannel } from './channels';
import { emit as emitPlatformEvent } from '$lib/events/platform-bus';

const SITE_URL = 'https://strangeramblings.com';

export interface NotifyInput {
  category: string;
  title: string;
  body: string;
  /** Site-relative, e.g. `/health`. Absolute URLs are passed through. */
  url?: string | null;
  severity?: 'info' | 'warn' | 'alert';
  /**
   * Collapses repeats. Two raises with the same key inside the category's floor
   * produce one row; without a key the floor still applies to the category as a
   * whole, which is the stricter reading and the right default for a metric.
   */
  dedupeKey?: string | null;
  data?: Record<string, unknown> | null;
  /**
   * A floor this ONE raise wants, in seconds.
   *
   * Combined with the category's by taking the larger. It is a caller saying
   * "not more often than this", never "ignore what the reader asked for" — the
   * shim in `push.ts` passes sixty seconds to collapse a burst, and that must
   * not quietly undo a three-hour setting made on the phone.
   */
  minIntervalSeconds?: number;
  /**
   * The exact WhatsApp text, already formatted, in place of the default
   * `*title*` + body + link. For a sender that composed its own message — the
   * `whatsapp` workflow node routing an owner-bound send through here — so the
   * owner receives what was written, not a re-wrapped copy of it.
   */
  whatsappText?: string;
  /**
   * Channels this ONE raise names explicitly, overriding the category's route
   * for them. A workflow step the owner configured as "send to WhatsApp" must
   * reach WhatsApp whatever its category routes to (2026-09-25: a `chat`
   * category, iPhone-only, swallowed "send a joke to my whatsapp").
   */
  channels?: { whatsapp?: boolean; native?: boolean };
}

export interface NotifyResult {
  raised: boolean;
  /** Why not, when `raised` is false. Logged, never shown to a reader. */
  reason?: 'throttled' | 'duplicate' | 'error';
  id?: string;
  whatsapp?: boolean;
  /** Which channels the category's route had open for this raise. */
  routed?: { whatsapp: boolean; native: boolean };
}

/** The effective route for a category: the stored row, else the catalogue. */
export async function routeFor(categoryId: string): Promise<{
  category: NotificationCategory;
  whatsapp: boolean;
  native: boolean;
  minIntervalSeconds: number;
  lastRaisedAt: Date | null;
}> {
  const category = categoryOf(categoryId);
  const [row] = await db
    .select()
    .from(notificationRoutes)
    .where(eq(notificationRoutes.category, category.id))
    .limit(1);
  return {
    category,
    whatsapp: row?.whatsapp ?? category.whatsapp,
    native: row?.native ?? category.native,
    minIntervalSeconds: row?.minIntervalSeconds ?? category.minIntervalSeconds,
    lastRaisedAt: row?.lastRaisedAt ?? null,
  };
}

/** Every category with its effective route, for a settings screen. */
export async function listRoutes() {
  const rows = await db.select().from(notificationRoutes);
  const byId = new Map(rows.map((r) => [r.category, r]));
  return NOTIFICATION_CATEGORIES.map((category) => {
    const row = byId.get(category.id);
    return {
      id: category.id,
      label: category.label,
      description: category.description,
      whatsapp: row?.whatsapp ?? category.whatsapp,
      native: row?.native ?? category.native,
      minIntervalSeconds: row?.minIntervalSeconds ?? category.minIntervalSeconds,
      /** True when this differs from the shipped default. */
      customised: Boolean(row),
    };
  });
}

export async function setRoute(
  categoryId: string,
  patch: { whatsapp?: boolean; native?: boolean; minIntervalSeconds?: number },
): Promise<void> {
  const category = categoryOf(categoryId);
  // The row may not exist, so an update alone would silently do nothing — the
  // defaults live in the catalogue, not in the table. Upsert with the
  // catalogue's values as the base, then apply the patch over them.
  const base = {
    whatsapp: category.whatsapp,
    native: category.native,
    minIntervalSeconds: category.minIntervalSeconds,
  };
  const next = { ...base, ...stripUndefined(patch) };
  await db
    .insert(notificationRoutes)
    .values({ category: category.id, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: notificationRoutes.category,
      set: { ...next, updatedAt: new Date() },
    });
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

/**
 * Raise one notification.
 *
 * Returns whether a row was written. A `false` is ordinary — a throttled health
 * reading is the system working — so callers should not treat it as failure.
 */
export async function notifyOwner(input: NotifyInput): Promise<NotifyResult> {
  try {
    const routed = await routeFor(input.category);
    const route = {
      ...routed,
      whatsapp: input.channels?.whatsapp ?? routed.whatsapp,
      native: input.channels?.native ?? routed.native,
    };
    const floor = Math.max(input.minIntervalSeconds ?? 0, route.minIntervalSeconds);

    if (floor > 0) {
      const since = new Date(Date.now() - floor * 1000);
      // Scoped to the dedupe key when there is one, and to the whole category
      // when there is not. The key is what lets two different health figures
      // each have their own three hours; without it the category shares one.
      const recent = await db
        .select({ id: notificationEvents.id })
        .from(notificationEvents)
        .where(
          input.dedupeKey
            ? and(
                eq(notificationEvents.category, route.category.id),
                eq(notificationEvents.dedupeKey, input.dedupeKey),
                gt(notificationEvents.createdAt, since),
              )
            : and(
                eq(notificationEvents.category, route.category.id),
                gt(notificationEvents.createdAt, since),
              ),
        )
        .limit(1);
      if (recent.length > 0) {
        return { raised: false, reason: input.dedupeKey ? 'duplicate' : 'throttled' };
      }
    }

    // Both channels closed is a deliberate "do not tell me about this" — and it
    // is still written down. A ledger that only records what was DELIVERED
    // cannot answer "did the site try to tell me anything while that was off",
    // and switching a category back on would silently lose the history. The row
    // is stamped collected on the way in, so the phone never raises it.
    const silent = !route.whatsapp && !route.native;

    const [row] = await db
      .insert(notificationEvents)
      .values({
        category: route.category.id,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 2000),
        url: input.url ?? null,
        severity: input.severity ?? 'info',
        dedupeKey: input.dedupeKey ?? null,
        data: input.data ?? null,
        // A category routed away from the phone is marked collected on the way
        // in, so the phone's poll — "native and not yet collected" — never sees
        // it. That keeps the poll one index scan rather than a join against the
        // routing table on every request.
        nativeAt: route.native && !silent ? null : new Date(),
        // A silent row is read, because nobody was ever going to be shown it.
        readAt: silent ? new Date() : null,
      })
      .returning({ id: notificationEvents.id });

    await db
      .insert(notificationRoutes)
      .values({
        category: route.category.id,
        whatsapp: route.whatsapp,
        native: route.native,
        minIntervalSeconds: route.minIntervalSeconds,
        lastRaisedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: notificationRoutes.category,
        set: { lastRaisedAt: new Date() },
      });

    let whatsapp = false;
    if (route.whatsapp && !silent) whatsapp = await sendWhatsApp(input, row.id);

    // A workflow can start on this. Emitted inside a run (a notify node), it
    // carries that run as its origin, so the workflow cannot page itself in a loop.
    if (!silent) {
      emitPlatformEvent(
        'notification.raised',
        {
          id: row.id,
          category: route.category.id,
          title: input.title,
          body: input.body,
          url: input.url ?? null,
          severity: input.severity ?? 'info',
          whatsapp,
          native: route.native,
        },
        { source: 'notifyOwner' },
      );
    }

    return {
      raised: !silent,
      id: row.id,
      whatsapp,
      routed: { whatsapp: route.whatsapp, native: route.native },
      reason: silent ? 'throttled' : undefined,
    };
  } catch (error) {
    console.error('[notify] raise failed', error);
    return { raised: false, reason: 'error' };
  }
}

/**
 * The WhatsApp half — through the registered channel, not through an import.
 *
 * This used to `await import('$lib/workflows/whatsapp/service')`, which pointed
 * a platform module at a domain one and made the two mutually dependent. The
 * sender registers itself at boot instead (`$lib/workflows/index.ts`), so this
 * file names a channel and knows nothing about what fills it.
 *
 * An absent channel is an ordinary outcome, not a failure: the run worker and
 * every test process have no WhatsApp client, and the alert is already written.
 */
async function sendWhatsApp(input: NotifyInput, eventId: string): Promise<boolean> {
  const send = notificationChannel('whatsapp');
  if (!send) return false;
  const link = input.url
    ? `\n\n${input.url.startsWith('http') ? input.url : SITE_URL + input.url}`
    : '';
  const sent = await send(input.whatsappText ?? `*${input.title}*\n\n${input.body}${link}`);
  if (!sent) {
    console.error(`[notify] the whatsapp channel did not take ${eventId}`);
    return false;
  }
  await db
    .update(notificationEvents)
    .set({ whatsappAt: new Date() })
    .where(eq(notificationEvents.id, eventId));
  return true;
}

/**
 * What the phone has not collected yet, oldest first.
 *
 * Oldest first, not newest: these become local notifications in the order they
 * are posted, and a notification centre that reads bottom-to-top tells the
 * morning's story backwards.
 */
export async function pendingForDevice(limit = 20) {
  return db
    .select({
      id: notificationEvents.id,
      category: notificationEvents.category,
      title: notificationEvents.title,
      body: notificationEvents.body,
      url: notificationEvents.url,
      severity: notificationEvents.severity,
      data: notificationEvents.data,
      createdAt: notificationEvents.createdAt,
    })
    .from(notificationEvents)
    .where(isNull(notificationEvents.nativeAt))
    .orderBy(notificationEvents.createdAt)
    .limit(Math.min(Math.max(limit, 1), 100));
}

/**
 * Mark rows as collected. Ids the phone does not recognise are ignored.
 *
 * The ids are filtered to well-formed uuids before they reach the query. Not
 * for injection — `inArray` parameterises — but because `id` is a `uuid`
 * column and Postgres ERRORS on a malformed literal rather than not matching
 * it. One junk id from a stale build would fail the whole acknowledgement, and
 * the phone would re-raise every notification in the batch on its next refresh.
 */
export async function markCollected(ids: string[]): Promise<number> {
  const valid = ids.filter((id) => UUID.test(id));
  if (valid.length === 0) return 0;
  const rows = await db
    .update(notificationEvents)
    .set({ nativeAt: new Date() })
    .where(and(isNull(notificationEvents.nativeAt), inArray(notificationEvents.id, valid)))
    .returning({ id: notificationEvents.id });
  return rows.length;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The inbox, for the app's own list. */
export async function recentEvents(limit = 50) {
  return db
    .select()
    .from(notificationEvents)
    .orderBy(desc(notificationEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function markAllRead(): Promise<void> {
  await db
    .update(notificationEvents)
    .set({ readAt: new Date() })
    .where(isNull(notificationEvents.readAt));
}

/**
 * Keep the ledger from growing without limit.
 *
 * Ninety days of everything. Called by the health watcher's tick rather than
 * given a timer of its own — one more `setInterval` in this process for a
 * delete that takes milliseconds is not worth the service-role reasoning.
 */
export async function pruneEvents(days = 90): Promise<void> {
  await db
    .delete(notificationEvents)
    .where(lt(notificationEvents.createdAt, new Date(Date.now() - days * 24 * 60 * 60 * 1000)));
}

export { NOTIFICATION_CATEGORIES } from './categories';
export { registerNotificationChannel, clearNotificationChannels } from './channels';
export type { NotificationSender } from './channels';
export { deliveryReport, type DeliveryReport } from './report';
