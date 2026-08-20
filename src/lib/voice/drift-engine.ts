// The monthly drift check.
//
// Measures the live corpus, compares it to the committed card, and writes a note
// to the datastore. It changes nothing else — no card rewrite, no prompt edit,
// no PR. Rebuilding the card is a deliberate act with a commit behind it,
// because the card is the single description of how everything writes and an
// unattended overnight change to it would be untraceable.
//
// Structured after `selfimprove/engine.ts`, which is the house pattern for this:
// croner, a prod-only hostname gate, a kill switch in app settings, and a
// stop function so a hot reload does not stack schedules.

import os from 'node:os';
import { Cron } from 'croner';
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
const CRON_EXPR = '0 6 1 * *';
const CRON_TZ = 'Europe/London';

let started = false;
let cronJob: Cron | null = null;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

/** Idempotent; safe to call once from hooks.server.ts. */
export function startVoiceDrift(): void {
  if (started) return;
  started = true;

  // Prod-only, matching selfimprove. homeserv has the same database in dev use
  // and a second writer would just duplicate rows.
  if (os.hostname() === 'homeserv' && process.env.VOICE_DRIFT_ALLOW_DEV !== '1') {
    console.log('[voice-drift] host is homeserv — monthly check disabled. Set VOICE_DRIFT_ALLOW_DEV=1 to enable.');
    return;
  }

  try {
    cronJob = new Cron(CRON_EXPR, { timezone: CRON_TZ }, () => {
      void (async () => {
        try {
          if ((await getSetting<boolean>(SETTINGS_ENABLED_KEY)) === false) {
            console.log('[voice-drift] kill switch is off — skipping');
            return;
          }
          await runDriftCheck('cron');
        } catch (err) {
          console.error('[voice-drift] check failed:', errMsg(err));
        }
      })();
    });
    console.log(`[voice-drift] monthly check scheduled (${CRON_EXPR} ${CRON_TZ})`);
  } catch (err) {
    console.error('[voice-drift] failed to schedule cron:', errMsg(err));
  }
}

export function stopVoiceDrift(): void {
  if (cronJob) cronJob.stop();
  cronJob = null;
  started = false;
}
