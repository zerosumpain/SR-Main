// src/lib/home/presence/companion-accounts.ts
//
// Accounts on the iPhone companion pilot, managed from the site: the calls
// /welcome makes to set a person up (create them in the owner's family, mint a
// pairing code, turn location sharing on or off) and the calls
// /admin/access/devices makes to list and revoke paired phones.
//
// Same lane and token as the household trail (`./companion`): Bearer
// COMPANION_HOUSEHOLD_TOKEN against COMPANION_URL (default loopback :5295).
// The pilot operates only within the owner's family, so this client cannot
// reach anybody the household lane could not already see.
//
// Nothing here throws. Every call answers a `PilotResult`, so a page can say
// "the app server is unreachable" beside the parts of it that still work,
// rather than failing whole. Unset token = `unconfigured`, and no request is
// made — the state of every host that is not production.
//
// Spec: docs/superpowers/specs/2026-09-26-apple-app-breakout.md (Contract A)

import { companionToken, companionUrl } from './companion';

const TIMEOUT_MS = 8_000;

export type PilotFailure = 'unconfigured' | 'unreachable' | 'refused' | 'not-found' | 'conflict' | 'bad-response';

export type PilotResult<T> = { ok: true; value: T } | { ok: false; reason: PilotFailure; status?: number };

export interface PilotUser {
  id: string | number;
  email: string;
  name: string;
  created: boolean;
}

export interface PilotPairCode {
  code: string;
  /** The exact JSON string the QR encodes. */
  payload: string;
  /** Seconds. */
  expiresIn: number;
}

export interface PilotDevice {
  id: string;
  email: string;
  name: string | null;
  label: string | null;
  created: string | null;
  expires: string | null;
  lastUsed: string | null;
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<PilotResult<unknown>> {
  const token = companionToken();
  if (!token) return { ok: false, reason: 'unconfigured' };
  let res: Response;
  try {
    res = await fetchImpl(`${companionUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (res.status === 204) return { ok: true, value: null };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'refused', status: res.status };
  if (res.status === 404) return { ok: false, reason: 'not-found', status: 404 };
  if (res.status === 409) return { ok: false, reason: 'conflict', status: 409 };
  if (!res.ok) return { ok: false, reason: 'unreachable', status: res.status };
  try {
    return { ok: true, value: await res.json() };
  } catch {
    return { ok: false, reason: 'bad-response', status: res.status };
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** Create (or find) a person in the owner's family. 409 = they belong to another family. */
export async function upsertPilotUser(
  email: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PilotResult<PilotUser>> {
  const r = await call('POST', '/api/apple/household/users', { email: email.trim().toLowerCase(), name }, fetchImpl);
  if (!r.ok) return r;
  const b = (r.value ?? {}) as Record<string, unknown>;
  if (typeof b.email !== 'string') return { ok: false, reason: 'bad-response' };
  return {
    ok: true,
    value: {
      id: typeof b.id === 'number' || typeof b.id === 'string' ? b.id : '',
      email: b.email,
      name: str(b.name) ?? name,
      created: b.created === true,
    },
  };
}

/** A fresh ten-minute pairing code for a person in the family; the old one stops working. */
export async function pilotPairCode(email: string, fetchImpl: typeof fetch = fetch): Promise<PilotResult<PilotPairCode>> {
  const r = await call('POST', '/api/apple/household/pair-code', { email: email.trim().toLowerCase() }, fetchImpl);
  if (!r.ok) return r;
  const b = (r.value ?? {}) as Record<string, unknown>;
  if (typeof b.code !== 'string' || typeof b.payload !== 'string') return { ok: false, reason: 'bad-response' };
  return {
    ok: true,
    value: { code: b.code, payload: b.payload, expiresIn: typeof b.expiresIn === 'number' ? b.expiresIn : 600 },
  };
}

/** Every live companion device in the family. */
export async function listPilotDevices(fetchImpl: typeof fetch = fetch): Promise<PilotResult<PilotDevice[]>> {
  const r = await call('GET', '/api/apple/household/devices', undefined, fetchImpl);
  if (!r.ok) return r;
  const list = ((r.value ?? {}) as { devices?: unknown }).devices;
  if (!Array.isArray(list)) return { ok: false, reason: 'bad-response' };
  const devices: PilotDevice[] = [];
  for (const d of list as Record<string, unknown>[]) {
    const id = str(d?.id);
    const email = str(d?.email);
    if (!id || !email) continue;
    devices.push({
      id,
      email: email.toLowerCase(),
      name: str(d.name),
      label: str(d.label),
      created: str(d.created),
      expires: str(d.expires),
      lastUsed: str(d.lastUsed),
    });
  }
  return { ok: true, value: devices };
}

export async function revokePilotDevice(id: string, fetchImpl: typeof fetch = fetch): Promise<PilotResult<null>> {
  const r = await call('DELETE', `/api/apple/household/devices/${encodeURIComponent(id)}`, undefined, fetchImpl);
  return r.ok ? { ok: true, value: null } : r;
}

export async function setPilotSharing(
  email: string,
  enabled: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<PilotResult<{ sharing: boolean }>> {
  const r = await call('PUT', '/api/apple/household/sharing', { email: email.trim().toLowerCase(), enabled }, fetchImpl);
  if (!r.ok) return r;
  const b = (r.value ?? {}) as Record<string, unknown>;
  // The pilot stores sharing as 0/1; accept either spelling.
  const sharing = b.sharing === true || b.sharing === 1;
  return { ok: true, value: { sharing } };
}

/** What a page says about a failure, in words. */
export function pilotFailureText(reason: PilotFailure): string {
  switch (reason) {
    case 'unconfigured':
      return 'The app server is not configured on this host.';
    case 'refused':
      return 'The app server refused this site’s key.';
    case 'not-found':
      return 'The app server does not know that account.';
    case 'conflict':
      return 'That address belongs to another family on the app server.';
    default:
      return 'The app server is unreachable right now.';
  }
}
