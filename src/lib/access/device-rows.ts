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
}

export interface SiteDeviceIn {
  id: string;
  ownerEmail: string;
  label: string | null;
  createdAt: Date | string;
  expiresAt: Date | string;
  revokedAt: Date | string | null;
  lastUsedAt: Date | string | null;
}

export interface PilotDeviceIn {
  id: string;
  email: string;
  name: string | null;
  label: string | null;
  created: string | null;
  expires: string | null;
  lastUsed: string | null;
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
