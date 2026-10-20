// The one table /admin/access/devices renders: every paired phone, both lanes,
// one row each. PURE — the loader fetches, this merges, and the test drives it.
//
// Two lanes, deliberately named for what they open rather than where they
// live: the companion pilot's credential is "Health & location", the site's
// `native_credentials` row is "Chat & news". A phone usually holds both, and
// revoking one leaves the other working — which is why they are separate rows.

export type Lane = 'companion' | 'site';

export const LANE_LABEL: Record<Lane, string> = {
  companion: 'Health & location',
  site: 'Chat & news',
};

/** What a phone last said it was running (`$lib/server/native-telemetry`). */
export interface AppOnPhone {
  version: string | null;
  build: number;
  commit: string | null;
  /** 'testflight' | 'adhoc' | 'xcode', from a build that says; null from one older than the field. */
  channel: string | null;
  /** When this build was first seen on the phone. */
  since: string | null;
}

export interface DeviceRow {
  /** Unique across lanes, for keyed each-blocks. */
  key: string;
  lane: Lane;
  id: string;
  email: string;
  person: string;
  label: string | null;
  paired: string | null;
  lastUsed: string | null;
  expires: string | null;
  status: 'active' | 'revoked' | 'expired';
  /** Null from an app older than the telemetry headers. */
  app: AppOnPhone | null;
  os: string | null;
  model: string | null;
  /** The name the phone gave itself — the one thing that tells two of a person's phones apart. */
  deviceName: string | null;
  /** Registered for push (site lane); null where the lane does not say. */
  push: boolean | null;
}

export interface SiteDeviceIn {
  id: string;
  ownerEmail: string;
  label: string | null;
  createdAt: Date | string;
  expiresAt: Date | string;
  revokedAt: Date | string | null;
  lastUsedAt: Date | string | null;
  appVersion?: string | null;
  appBuild?: number | null;
  appCommit?: string | null;
  appChannel?: string | null;
  appSeenAt?: Date | string | null;
  osVersion?: string | null;
  deviceModel?: string | null;
  deviceName?: string | null;
  hasPush?: boolean;
}

export interface PilotDeviceIn {
  id: string;
  email: string;
  name: string | null;
  label: string | null;
  created: string | null;
  expires: string | null;
  lastUsed: string | null;
  app?: AppOnPhone | null;
  os?: string | null;
  model?: string | null;
  deviceName?: string | null;
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "0.1.136 (136)" for a phone that said, nothing for one that did not. */
export function appLabel(row: Pick<DeviceRow, 'app'>): string | null {
  if (!row.app) return null;
  return row.app.version ? `${row.app.version} (${row.app.build})` : `build ${row.app.build}`;
}

/**
 * What to call the phone: its own name first, then the lane's label
 * ("SR iPhone", "iPhone"), with the model beside it when known so two phones
 * of one person read differently even before either is named.
 */
export function phoneLabel(row: Pick<DeviceRow, 'label' | 'model' | 'deviceName'>): string {
  const name = row.deviceName ?? row.label ?? 'iPhone';
  return row.model && row.model !== name ? `${name} · ${row.model}` : name;
}

/**
 * Merge both lanes into one list, grouped by person (named, else by email),
 * then lane, newest pairing first. `names` maps a lower-cased email to what
 * the site calls that person (the allow-list note, "You" for an owner); the
 * pilot's own name is the fallback, then the address itself.
 */
export function mergeDeviceRows(
  site: readonly SiteDeviceIn[],
  pilot: readonly PilotDeviceIn[],
  names: ReadonlyMap<string, string>,
  now: Date,
): DeviceRow[] {
  const nameOf = (email: string, fallback?: string | null) =>
    names.get(email.toLowerCase()) ?? (fallback?.trim() || email);

  const rows: DeviceRow[] = [
    ...site.map((d): DeviceRow => {
      const expires = iso(d.expiresAt);
      const status = d.revokedAt
        ? 'revoked'
        : expires && new Date(expires).getTime() <= now.getTime()
          ? 'expired'
          : 'active';
      return {
        key: `site:${d.id}`,
        lane: 'site',
        id: d.id,
        email: d.ownerEmail.toLowerCase(),
        person: nameOf(d.ownerEmail),
        label: d.label,
        paired: iso(d.createdAt),
        lastUsed: iso(d.lastUsedAt),
        expires,
        status,
        app: d.appBuild
          ? { version: d.appVersion ?? null, build: d.appBuild, commit: d.appCommit ?? null, channel: d.appChannel ?? null, since: iso(d.appSeenAt) }
          : null,
        os: d.osVersion ?? null,
        model: d.deviceModel ?? null,
        deviceName: d.deviceName ?? null,
        push: d.hasPush ?? null,
      };
    }),
    // The pilot lists live credentials only, so every row it sends is active
    // unless its own expiry has already passed.
    ...pilot.map((d): DeviceRow => {
      const expires = iso(d.expires);
      return {
        key: `companion:${d.id}`,
        lane: 'companion',
        id: d.id,
        email: d.email.toLowerCase(),
        person: nameOf(d.email, d.name),
        label: d.label,
        paired: iso(d.created),
        lastUsed: iso(d.lastUsed),
        expires,
        status: expires && new Date(expires).getTime() <= now.getTime() ? 'expired' : 'active',
        app: d.app ?? null,
        os: d.os ?? null,
        model: d.model ?? null,
        deviceName: d.deviceName ?? null,
        push: null,
      };
    }),
  ];

  const laneOrder: Record<Lane, number> = { companion: 0, site: 1 };
  return rows.sort(
    (a, b) =>
      a.person.localeCompare(b.person) ||
      laneOrder[a.lane] - laneOrder[b.lane] ||
      (b.paired ?? '').localeCompare(a.paired ?? ''),
  );
}
