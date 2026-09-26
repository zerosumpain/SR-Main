// src/lib/home/presence/members.ts
//
// The household as a table rather than a constant. `household_member` holds one
// row per person: their trail subject, the email that maps a sign-in or a pilot
// user to them, where their trail is written from (`source`), and who their
// movements alert. FAMILY_SUBJECTS is now only the seed for an empty table.
//
// `source` is consent made concrete (spec D1): 'life360' is polled from Home
// Assistant, 'companion' comes only from the iPhone app through the pilot, and
// 'none' writes nothing. A person on 'companion' who turns sharing off is shown
// as not sharing, never silently picked up from Life360 instead.

import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { householdMember, type HouseholdMemberAlerts } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { FAMILY_SUBJECTS, type SubjectEntity } from './types';

/** Set once the seed has been written. An empty table after that is the
 *  owner's doing, and re-seeding would quietly put everyone back on Life360. */
export const MEMBERS_SEEDED_KEY = 'home.presence.membersSeeded';

export const MEMBER_SOURCES = ['life360', 'companion', 'none'] as const;
export type MemberSource = (typeof MEMBER_SOURCES)[number];

export type { HouseholdMemberAlerts };

export interface HouseholdMember {
  subject: string;
  /** Lower-cased. Null for someone on Life360 only. */
  email: string | null;
  displayName: string;
  source: MemberSource;
  haPersonEntity: string | null;
  whatsapp: string | null;
  alerts: HouseholdMemberAlerts;
}

export type MemberPatch = Partial<
  Pick<HouseholdMember, 'email' | 'displayName' | 'source' | 'haPersonEntity' | 'whatsapp' | 'alerts'>
>;

function isMemberSource(v: unknown): v is MemberSource {
  return typeof v === 'string' && (MEMBER_SOURCES as readonly string[]).includes(v);
}

function normaliseEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return e ? e : null;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** A row as the database returns it, read defensively: an unknown source
 *  reads as 'none' so a bad value can never start polling someone. */
function toMember(row: Record<string, unknown>): HouseholdMember {
  const alerts = row.alerts && typeof row.alerts === 'object' ? (row.alerts as HouseholdMemberAlerts) : {};
  return {
    subject: String(row.subject),
    email: normaliseEmail(row.email as string | null),
    displayName: String(row.displayName ?? row.subject),
    source: isMemberSource(row.source) ? row.source : 'none',
    haPersonEntity: (row.haPersonEntity as string | null) ?? null,
    whatsapp: (row.whatsapp as string | null) ?? null,
    alerts,
  };
}

/** The rows an empty table is seeded with: today's household, all on Life360. */
export function seedMembers(): HouseholdMember[] {
  return FAMILY_SUBJECTS.map((f) => ({
    subject: f.subject,
    email: null,
    displayName: capitalise(f.subject),
    source: 'life360' as const,
    haPersonEntity: f.entity,
    whatsapp: null,
    alerts: {},
  }));
}

async function selectAll(): Promise<HouseholdMember[]> {
  const rows = await db.select().from(householdMember).orderBy(asc(householdMember.createdAt));
  return (rows as Array<Record<string, unknown>>).map(toMember);
}

/**
 * Everyone in the household. Seeds from FAMILY_SUBJECTS the first time it finds
 * the table empty, and only ever once (MEMBERS_SEEDED_KEY): an owner who
 * removes everyone must not find them all back on Life360 two minutes later.
 * `onConflictDoNothing` makes two concurrent first reads safe.
 */
export async function listMembers(): Promise<HouseholdMember[]> {
  const rows = await selectAll();
  if (rows.length > 0) return rows;
  if ((await getSetting<boolean>(MEMBERS_SEEDED_KEY)) === true) return rows;
  await db
    .insert(householdMember)
    .values(seedMembers())
    .onConflictDoNothing();
  await setSetting(MEMBERS_SEEDED_KEY, true);
  return selectAll();
}

/**
 * Whether Home Assistant may write this subject's trail: only a member whose
 * source is 'life360'. Someone not in the table, on the app, or on 'none' is
 * not tracked from HA. PURE.
 */
export function isLife360Subject(members: readonly HouseholdMember[], subject: string): boolean {
  return members.some((m) => m.subject === subject && m.source === 'life360');
}

export async function memberByEmail(email: string): Promise<HouseholdMember | null> {
  const e = normaliseEmail(email);
  if (!e) return null;
  const [row] = await db.select().from(householdMember).where(eq(householdMember.email, e)).limit(1);
  return row ? toMember(row as Record<string, unknown>) : null;
}

export async function updateMember(subject: string, patch: MemberPatch): Promise<HouseholdMember | null> {
  const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if ('email' in patch) set.email = normaliseEmail(patch.email);
  if (patch.source !== undefined && !isMemberSource(patch.source)) {
    throw new Error(`unknown member source: ${String(patch.source)}`);
  }
  const [row] = await db
    .update(householdMember)
    .set(set)
    .where(eq(householdMember.subject, subject))
    .returning();
  return row ? toMember(row as Record<string, unknown>) : null;
}

/**
 * Who hears about a person's movements: everyone except the mover whose follow
 * list is absent (everyone) or names the mover. An empty list means nobody.
 * PURE.
 */
export function followers(members: readonly HouseholdMember[], moverSubject: string): HouseholdMember[] {
  return members.filter(
    (m) => m.subject !== moverSubject && (m.alerts?.follow == null || m.alerts.follow.includes(moverSubject)),
  );
}

/** The people Home Assistant is polled for: Life360 members with an entity. PURE. */
export function lifeSubjects(members: readonly HouseholdMember[]): SubjectEntity[] {
  return members
    .filter((m) => m.source === 'life360' && !!m.haPersonEntity)
    .map((m) => ({ subject: m.subject, entity: m.haPersonEntity as string }));
}
