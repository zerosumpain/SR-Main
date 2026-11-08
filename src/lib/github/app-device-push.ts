// One build of the iPhone app, sent to ONE phone — the owner's call, made per
// phone on /admin/access/app (John, 2026-10-21: "push current, or a specific
// build … to any one of the connected iphone devices").
//
// The family release (`$lib/github/app-release`) chooses what every phone is
// offered. A pin overrides it for one phone: its hourly update check
// (`/api/native/app-update`) answers with the pinned build instead, flagged
// `pushed`, and the phone is sent a push so it asks now rather than within the
// hour. An app that knows the flag offers the pinned build whatever it runs —
// an older build is a rollback, and a TestFlight copy may be swapped for the
// ad-hoc one; an app from before the flag offers it only when it is later.
//
// The pinned build is installed through the family's install link with a
// per-build key (`buildQuery`), so the copy fetched is the one sent, and that
// link can fetch no other build.
//
// A pin holds until the owner releases a build to the family (the release is
// newer than the pin: everybody moves on together), sends the phone another
// build, or takes it back to the family's build. Only the copies GitHub holds
// can be sent, and a copy installs only on the phones in its profile.

import { getSetting, setSetting } from '$lib/server/models/settings';
import { pushToDevice, type PushSender } from '$lib/server/push-devices';
import { sendPush } from '$lib/server/apns';
import { adhocBuildOf, listAdhocDrafts, type AdhocBuild } from './adhoc-builds';
import { currentRelease, type AppRelease } from './app-release';

export const PINS_KEY = 'app_device_builds';

export interface DevicePin {
  build: number;
  commit: string | null;
  at: string;
  by: string | null;
  /** What Apple said when the push went: sent, no token on the phone, or refused. */
  push: 'sent' | 'no-token' | 'refused';
}

export type DevicePins = Record<string, DevicePin>;

/** A stored value, read leniently: anything malformed is no pin. PURE. */
export function readPins(value: unknown): DevicePins {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out: DevicePins = {};
  for (const [id, raw] of Object.entries(o)) {
    const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (!p || typeof p.build !== 'number' || !Number.isInteger(p.build) || p.build <= 0 || typeof p.at !== 'string') continue;
    out[id] = {
      build: p.build,
      commit: typeof p.commit === 'string' ? p.commit : null,
      at: p.at,
      by: typeof p.by === 'string' ? p.by : null,
      push: p.push === 'sent' || p.push === 'refused' ? p.push : 'no-token',
    };
  }
  return out;
}

/**
 * The pins still in force: a family release made after a pin ends it. A
 * release the site pinned itself (the first read) ends nothing. PURE.
 */
export function livePins(pins: DevicePins, release: Pick<AppRelease, 'history'> | null): DevicePins {
  const lastPressed = release?.history.find((h) => h.kind !== 'pinned')?.at ?? null;
  if (!lastPressed) return pins;
  return Object.fromEntries(Object.entries(pins).filter(([, p]) => p.at > lastPressed));
}

/** The record with this phone's pin set (or, with null, removed). PURE. */
export function withPin(pins: DevicePins, deviceId: string, pin: DevicePin | null): DevicePins {
  const next = { ...pins };
  if (pin) next[deviceId] = pin;
  else delete next[deviceId];
  return next;
}

/** Every pin in force, by site credential id. */
export async function devicePins(release?: AppRelease | null): Promise<DevicePins> {
  const stored = readPins(await getSetting(PINS_KEY));
  return livePins(stored, release === undefined ? await currentRelease().catch(() => null) : release);
}

/**
 * The build pinned for this phone, with its build.json read — what its update
 * check offers instead of the family's. Null when there is no pin in force, or
 * GitHub no longer holds the build (the phone falls back to the family's).
 */
export async function pinnedAdhocBuild(deviceId: string): Promise<{ run: number; build: AdhocBuild } | null> {
  const pin = (await devicePins())[deviceId];
  if (!pin) return null;
  const draft = (await listAdhocDrafts()).find((d) => d.run === pin.build);
  const build = draft ? await adhocBuildOf(draft) : null;
  return build ? { run: pin.build, build } : null;
}

/** The banner. Nothing private: the app asks the site which build when opened. PURE. */
export function buildPushMessage(build: number, version: string) {
  return {
    title: `SR ${version} is ready`,
    body: 'Sent to this phone. Open SR to install it.',
    category: 'app-update',
    threadId: 'app-update',
    // A second send replaces the first on the Lock Screen.
    collapseId: 'app-update',
    userInfo: { category: 'app-update', build },
    ttlSeconds: 3 * 24 * 3600,
  };
}

export type SendOutcome = { ok: true; pin: DevicePin } | { ok: false; error: string };

/**
 * Pin build `run` on this phone and push it there. The pin is saved whatever
 * Apple says: a phone with no token still picks it up at its next hourly check.
 */
export async function sendBuildToDevice(
  deviceId: string,
  run: number,
  by: string | null,
  send: PushSender = sendPush,
  now = new Date(),
): Promise<SendOutcome> {
  const draft = (await listAdhocDrafts(true)).find((d) => d.run === run);
  if (!draft) return { ok: false, error: `Build ${run} is not among the copies GitHub holds.` };
  const meta = await adhocBuildOf(draft).catch(() => null);
  const result = await pushToDevice(deviceId, buildPushMessage(run, meta?.version ?? `0.1.${run}`), send);
  const pin: DevicePin = {
    build: run,
    commit: draft.commit,
    at: now.toISOString(),
    by,
    push: result === null ? 'no-token' : result.ok ? 'sent' : 'refused',
  };
  await setSetting(PINS_KEY, withPin(readPins(await getSetting(PINS_KEY)), deviceId, pin));
  return { ok: true, pin };
}

/** Back to the family's build: forget this phone's pin. */
export async function unpinDevice(deviceId: string): Promise<boolean> {
  const pins = readPins(await getSetting(PINS_KEY));
  if (!pins[deviceId]) return false;
  await setSetting(PINS_KEY, withPin(pins, deviceId, null));
  return true;
}
