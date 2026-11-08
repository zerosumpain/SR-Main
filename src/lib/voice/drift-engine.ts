// The monthly drift check.
//
// Measures the live corpus, compares it to the committed card, and writes a note
// to the datastore. It changes nothing else — no card rewrite, no prompt edit,
// no PR. Rebuilding the card is a deliberate act with a commit behind it,
// because the card is the single description of how everything writes and an
// unattended overnight change to it would be untraceable.
//
// Scheduled by the heartbeat since 2026-10-02 (the `voice-drift` activity:
// daily in a 06:00–06:55 London window, acting only on the 1st), not by its own
// croner. The prod-only host gate and the kill switch are checked by
// `runMonthlyDriftCheck`, as the croner checked them at fire time.

import os from 'node:os';
import { ensureCollection, insertRecord, queryRecords } from '$lib/datastore';
import { getSetting } from '$lib/server/models/settings';
import { getVoiceCard } from './card';
import { measure } from './measure';
import { compareDrift, type DriftReport } from './drift';
import { CORPUS_AUTHORSHIP, MIN_CORPUS_WORDS } from '$lib/blog/authorship';
import { plainTextFromHtml, countWords } from '$lib/blog/readability';
import { db } from '$lib/db';
import { blogPosts } from '$lib/db/schema';

const COLLECTION = 'voice_drift';
const SYSTEM_ACTOR = 'system:voice-drift';
const SETTINGS_ENABLED_KEY = 'voice.drift.enabled';

/** 06:00 on the 1st of each month, London. Monthly because the corpus grows in
 *  posts, not in days — a nightly check would report the same thing 30 times. */
export const DRIFT_WINDOW = { start: '06:00', end: '06:55', tz: 'Europe/London' } as const;


export async function ensureDriftCollection(): Promise<void> {
  await ensureCollection(
    COLLECTION,
    {
      name: 'Voice drift',
      description: 'Monthly comparison of the live corpus against the committed Voice Card. Advisory only.',
      isSystem: true,
    },
    SYSTEM_ACTOR,
  );
}

/** Measure the corpus as it stands right now. */
export async function measureLiveCorpus() {
  const rows = await db
    .select({ authorship: blogPosts.authorship, content: blogPosts.content })
    .from(blogPosts);

  const human = rows.filter(
    (r) =>
      r.authorship === CORPUS_AUTHORSHIP &&
      countWords(plainTextFromHtml(r.content ?? '')) >= MIN_CORPUS_WORDS,
  );
  const generated = rows.filter((r) => r.authorship === 'generated');

  return measure({
    documents: human.map((r) => r.content ?? ''),
    contrast: generated.map((r) => r.content ?? ''),
  });
}

/**
 * Run the check now. Returns the report, and records it when material.
 *
 * Immaterial reports are not stored: a row a month saying "nothing moved" is
 * how a log becomes wallpaper.
 */
export async function runDriftCheck(trigger: 'cron' | 'manual'): Promise<DriftReport | null> {
  const card = getVoiceCard();
  if (!card) {
    console.warn('[voice-drift] no card built — nothing to compare against');
    return null;
  }

  const fresh = await measureLiveCorpus();
  const report = compareDrift(card, fresh, 'public-prose');

  console.log(`[voice-drift] ${trigger}: ${report.summary}`);

  if (report.material) {
    await ensureDriftCollection();
    await insertRecord(
      COLLECTION,
      { data: { ...report, trigger, observedAt: new Date().toISOString() } },
      SYSTEM_ACTOR,
    );
  }

  return report;
}

/** The most recent stored report, for the admin page. */
export async function latestDriftReport(): Promise<(DriftReport & { observedAt?: string }) | null> {
  try {
    const res = await queryRecords(
      COLLECTION,
      { limit: 1, sort: { field: 'createdAt', dir: 'desc' } },
      SYSTEM_ACTOR,
    );
    const row = res.records?.[0];
    return (row?.data as DriftReport & { observedAt?: string }) ?? null;
  } catch {
    // The collection may not exist until the first material report. Not an error.
    return null;
  }
}

/** Kept so `hooks.server.ts` (protected) need not change; the heartbeat schedules it. */
export function startVoiceDrift(): void {}

/** Is `at` the 1st of the month on the London calendar? PURE. */
export function isDriftDay(at: Date): boolean {
  return new Intl.DateTimeFormat('en-GB', { timeZone: DRIFT_WINDOW.tz, day: 'numeric' }).format(at) === '1';
}

/** The monthly check as the heartbeat runs it: why it did not run, or the report. */
export async function runMonthlyDriftCheck(at: Date): Promise<{ ran: false; reason: string } | { ran: true; report: DriftReport | null }> {
  if (!isDriftDay(at)) return { ran: false, reason: 'not the 1st of the month' };
  // Prod-only: homeserv has the same database in dev use and a second writer
  // would just duplicate rows.
  if (os.hostname() === 'homeserv' && process.env.VOICE_DRIFT_ALLOW_DEV !== '1') return { ran: false, reason: 'host is homeserv — monthly check runs on prod only' };
  if ((await getSetting<boolean>(SETTINGS_ENABLED_KEY)) === false) return { ran: false, reason: 'kill switch is off' };
  return { ran: true, report: await runDriftCheck('cron') };
}
