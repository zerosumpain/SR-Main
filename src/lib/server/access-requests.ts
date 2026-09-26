// Requests from the public form on /welcome.
//
// Anyone may ask; nobody learns anything by asking. The public answer is the
// same sentence whether the address is new, already pending, already on the
// allow-list or the owner's own — so the form cannot be used to find out who
// has an account here. Only a rate limit (per salted IP hash, the limiter
// blog comments already use) ever changes the response.
//
// A new request is stored `pending` and raised to the owner on the `access`
// notification category. The owner approves (the person joins the allow-list
// in the chosen groups, through the same write path as the add form) or
// declines at /admin/access.

import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessRequest } from '$lib/db/schema';
import { isEmailAllowedToSignIn } from './access';
import { addToAllowList } from './allow-list';
import { joinGroups } from './invites';
import { notifyOwner } from './notify';
import { rateLimit } from './public-request-rate-limit';

export type AccessRequestRow = typeof accessRequest.$inferSelect;

/** Three requests an hour from one address is a family, not a flood. */
export const REQUEST_LIMIT = { max: 3, windowMs: 60 * 60_000 } as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RequestInput {
  name: string;
  email: string;
  message: string | null;
  wantsApp: boolean;
}

export type Validated =
  | { ok: true; value: RequestInput }
  | { ok: false; field: 'name' | 'email' | 'message'; error: string };

/** Trim, bound and check the form. PURE. */
export function validateRequest(raw: {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  app?: unknown;
  /** The honeypot: a real person never fills it. */
  website?: unknown;
}): Validated {
  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
  const message = typeof raw.message === 'string' ? raw.message.trim() : '';
  if (!name) return { ok: false, field: 'name', error: 'Tell us your name' };
  if (name.length > 80) return { ok: false, field: 'name', error: 'That name is a little long' };
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return { ok: false, field: 'email', error: 'Enter the Google address you sign in with' };
  }
  if (message.length > 1000) return { ok: false, field: 'message', error: 'Keep it under 1,000 characters' };
  const app = raw.app === true || raw.app === 'on' || raw.app === 'true';
  return { ok: true, value: { name, email, message: message || null, wantsApp: app } };
}

export interface SubmitDeps {
  rateLimit(ipHash: string): boolean;
  isAllowed(email: string): Promise<boolean>;
  hasPending(email: string): Promise<boolean>;
  insert(row: RequestInput & { ipHash: string }): Promise<void>;
  notify(row: RequestInput): Promise<void>;
}

/**
 * What the public sees. `accepted` is the same for every well-formed request,
 * stored or not — that is the no-enumeration rule. `limited` is about the
 * CALLER, never the address.
 */
export type SubmitResult =
  | { status: 'accepted' }
  | { status: 'invalid'; field: 'name' | 'email' | 'message'; error: string }
  | { status: 'limited' };

export async function submitRequest(
  raw: Parameters<typeof validateRequest>[0],
  ipHash: string,
  deps: SubmitDeps,
): Promise<SubmitResult> {
  if (!deps.rateLimit(ipHash)) return { status: 'limited' };
  const v = validateRequest(raw);
  if (!v.ok) return { status: 'invalid', field: v.field, error: v.error };
  // A bot that filled the hidden field gets the same thank-you and costs nothing.
  if (typeof raw.website === 'string' && raw.website.trim()) return { status: 'accepted' };
  // Already allowed, or already asked: nothing to store and nobody to bother,
  // and the answer does not change.
  if (await deps.isAllowed(v.value.email)) return { status: 'accepted' };
  if (await deps.hasPending(v.value.email)) return { status: 'accepted' };
  await deps.insert({ ...v.value, ipHash });
  await deps.notify(v.value);
  return { status: 'accepted' };
}

const dbDeps: SubmitDeps = {
  rateLimit: (ipHash) => rateLimit('access-request', ipHash, REQUEST_LIMIT.max, REQUEST_LIMIT.windowMs),
  isAllowed: (email) => isEmailAllowedToSignIn(email),
  async hasPending(email) {
    const rows = await db
      .select({ id: accessRequest.id })
      .from(accessRequest)
      .where(and(eq(accessRequest.email, email), eq(accessRequest.status, 'pending')))
      .limit(1);
    return rows.length > 0;
  },
  async insert(row) {
    await db.insert(accessRequest).values({
      email: row.email,
      name: row.name,
      message: row.message,
      wants: { app: row.wantsApp },
      ipHash: row.ipHash,
    });
  },
  async notify(row) {
    await notifyOwner({
      category: 'access',
      title: `${row.name} asked for access`,
      body: `${row.email}${row.wantsApp ? ' · wants the iPhone app' : ''}${row.message ? `\n\n${row.message.slice(0, 300)}` : ''}`,
      url: '/admin/access#requests',
      severity: 'info',
      dedupeKey: `access-request:${row.email}`,
    });
  },
};

export function submitAccessRequest(raw: Parameters<typeof validateRequest>[0], ipHash: string) {
  return submitRequest(raw, ipHash, dbDeps);
}

// ── The owner's side ─────────────────────────────────────────────────────────

export interface AccessRequestView {
  id: string;
  email: string;
  name: string;
  message: string | null;
  wantsApp: boolean;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
}

/** Pending first, then the most recent decisions. */
export async function listRequests(limit = 50): Promise<AccessRequestView[]> {
  const rows = await db.select().from(accessRequest).orderBy(desc(accessRequest.createdAt)).limit(limit);
  const views = rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    message: r.message,
    wantsApp: (r.wants as Record<string, unknown> | null)?.app === true,
    status: r.status,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy,
  }));
  return [...views.filter((v) => v.status === 'pending'), ...views.filter((v) => v.status !== 'pending')];
}

/**
 * Approve or decline a pending request. Approving adds them to the allow-list
 * exactly as the add form does, then puts them in `groups` without removing
 * any they already hold. Null when there is no such pending request.
 */
export async function decideRequest(
  id: string,
  decision: 'approve' | 'decline',
  opts: { groups: readonly string[]; decidedBy: string | null },
): Promise<AccessRequestRow | null> {
  const [row] = await db
    .update(accessRequest)
    .set({
      status: decision === 'approve' ? 'approved' : 'declined',
      decidedAt: new Date(),
      decidedBy: opts.decidedBy,
    })
    .where(and(eq(accessRequest.id, id), eq(accessRequest.status, 'pending')))
    .returning();
  if (!row) return null;
  if (decision === 'approve') {
    await addToAllowList({ email: row.email, note: row.name, addedBy: opts.decidedBy });
    await joinGroups(row.email, opts.groups);
  }
  return row;
}
