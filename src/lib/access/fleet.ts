// The fleet: every phone the household runs the app on, one row per PHONE
// rather than per credential, with what it is running and when it was last
// heard from — what /admin/access/app renders. PURE: the loader fetches, this
// joins, and the test drives it.
//
// A phone usually holds two credentials (`device-rows`: the site's and the
// companion pilot's) that know nothing of each other. Since 2026-10-20 both
// lanes record what the phone says about itself, so two active rows of one
// person with the same model and the same name ARE one phone and are shown
// as one; a row without a model (an app older than the headers) stays on its
// own, because guessing would put a stranger's lane on the wrong phone.

import { phoneLabel, type AppOnPhone, type DeviceRow, type Lane } from './device-rows';

export type BuildState = 'current' | 'behind' | 'unknown';

export interface FleetPhone {
  key: string;
  email: string;
  person: string;
  /** `phoneLabel` of the row that knew most. */
  label: string;
  model: string | null;
  os: string | null;
  lanes: Lane[];
  /** The credential behind each lane, for a link to the person's page. */
  ids: Partial<Record<Lane, string>>;
  app: AppOnPhone | null;
  channel: string | null;
  build: BuildState;
  lastSeen: string | null;
  /** The companion lane's last call — its uploads. */
  lastUpload: string | null;
  push: boolean | null;
  paired: string | null;
}

export interface FleetEnrolment {
  id: string;
  email: string;
  person: string;
  name: string;
  product: string | null;
  os: string | null;
  enrolledAt: string;
  /** Whether the newest ad-hoc copy installs on it; null when the copy could not be read. */
  inLatestCopy: boolean | null;
}

export interface FleetPerson {
  email: string;
  person: string;
  phones: FleetPhone[];
  enrolments: FleetEnrolment[];
}

export interface FleetTotals {
  phones: number;
  /** Not heard from in `STALE_DAYS`. */
  stale: number;
  behind: number;
  /** Site-lane phones with no push token. */
  noPush: number;
  /** Enrolled for the ad-hoc copy but missing from its newest build. */
  notInCopy: number;
}

export interface Fleet {
  people: FleetPerson[];
  totals: FleetTotals;
}

export interface EnrolmentIn {
  id: string;
  email: string;
  name: string;
  product: string | null;
  osVersion: string | null;
  enrolledAt: Date | string;
}

export const STALE_DAYS = 7;

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

function buildState(app: AppOnPhone | null, latest: number | null): BuildState {
  if (!app || latest === null) return 'unknown';
  return app.build >= latest ? 'current' : 'behind';
}

/** One phone from the rows that are it: the site row's facts first, the companion's where the site's are missing. */
function phoneOf(rows: DeviceRow[], person: string, latest: number | null): FleetPhone {
  const site = rows.find((r) => r.lane === 'site') ?? null;
  const companion = rows.find((r) => r.lane === 'companion') ?? null;
  const first = site ?? rows[0];
  const app = site?.app ?? companion?.app ?? null;
  return {
    key: rows.map((r) => r.key).join('+'),
    email: first.email,
    person,
    label: phoneLabel(first),
    model: first.model ?? companion?.model ?? null,
    os: first.os ?? companion?.os ?? null,
    lanes: rows.map((r) => r.lane),
    ids: Object.fromEntries(rows.map((r) => [r.lane, r.id])),
    app,
    channel: app?.channel ?? null,
    build: buildState(app, latest),
    lastSeen: rows.map((r) => r.lastUsed).reduce(later, null),
    lastUpload: companion?.lastUsed ?? null,
    push: site?.push ?? null,
    paired: rows.map((r) => r.paired).reduce(later, null),
  };
}

/** Pair each site row with the one unmatched companion row that is the same phone; the rest stand alone. */
function groupPhones(rows: DeviceRow[], person: string, latest: number | null): FleetPhone[] {
  const companions = rows.filter((r) => r.lane === 'companion');
  const taken = new Set<string>();
  const phones: FleetPhone[] = [];
  for (const s of rows.filter((r) => r.lane === 'site')) {
    const twin = s.model
      ? companions.find((c) => !taken.has(c.key) && c.model === s.model && (c.deviceName ?? null) === (s.deviceName ?? null))
      : undefined;
    if (twin) taken.add(twin.key);
    phones.push(phoneOf(twin ? [s, twin] : [s], person, latest));
  }
  for (const c of companions) if (!taken.has(c.key)) phones.push(phoneOf([c], person, latest));
  return phones.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') || (b.paired ?? '').localeCompare(a.paired ?? ''));
}

export function buildFleet(input: {
  rows: readonly DeviceRow[];
  enrolled: readonly EnrolmentIn[];
  /** The newest build of the app, whichever channel; null when GitHub could not say. */
  latestBuild: number | null;
  /** The device names the newest ad-hoc copy installs on; null when it could not be read. */
  copyDevices: readonly string[] | null;
  /** What the site calls each address; the rows' own names are the fallback. */
  names: ReadonlyMap<string, string>;
  now: Date;
}): Fleet {
  const active = input.rows.filter((r) => r.status === 'active');
  const emails = new Set<string>([...active.map((r) => r.email), ...input.enrolled.map((e) => e.email.toLowerCase())]);
  const nameOf = (email: string) => input.names.get(email) ?? active.find((r) => r.email === email)?.person ?? email;
  const copy = input.copyDevices ? new Set(input.copyDevices.map((d) => d.toLowerCase())) : null;

  const people: FleetPerson[] = [...emails]
    .map((email) => ({
      email,
      person: nameOf(email),
      phones: groupPhones(
        active.filter((r) => r.email === email),
        nameOf(email),
        input.latestBuild,
      ),
      enrolments: input.enrolled
        .filter((e) => e.email.toLowerCase() === email)
        .map((e) => ({
          id: e.id,
          email,
          person: nameOf(email),
          name: e.name,
          product: e.product,
          os: e.osVersion,
          enrolledAt: iso(e.enrolledAt) ?? '',
          inLatestCopy: copy ? copy.has(e.name.toLowerCase()) : null,
        })),
    }))
    .sort((a, b) => a.person.localeCompare(b.person));

  const staleBefore = input.now.getTime() - STALE_DAYS * 86_400_000;
  const phones = people.flatMap((p) => p.phones);
  return {
    people,
    totals: {
      phones: phones.length,
      stale: phones.filter((p) => !p.lastSeen || new Date(p.lastSeen).getTime() < staleBefore).length,
      behind: phones.filter((p) => p.build === 'behind').length,
      noPush: phones.filter((p) => p.push === false).length,
      notInCopy: people.flatMap((p) => p.enrolments).filter((e) => e.inLatestCopy === false).length,
    },
  };
}
