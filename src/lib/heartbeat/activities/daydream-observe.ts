import { getSetting } from '$lib/server/models/settings';
import {
  hasFreshFix,
  pollAllSubjects,
  recordFix,
  recordGap,
} from '$lib/daydream/observe';
import {
  DEFAULT_SUBJECT,
  FAMILY_SUBJECTS,
  OBSERVE_CADENCE_SECONDS,
  SETTINGS_ENABLED_KEY,
  errMsg,
  type SubjectEntity,
} from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-observe';

interface ObserveConfig {
  /** Stand down while the push stream is this fresh. */
  pushFreshMins?: number;
  /** Legacy single-entity override, honoured for the default subject. */
  personEntity?: string;
  /** Everyone to observe. Defaults to the whole household (FAMILY_SUBJECTS). */
  subjects?: SubjectEntity[];
}

const DEFAULTS: Required<Omit<ObserveConfig, 'subjects'>> = {
  pushFreshMins: 10,
  personEntity: 'person.john',
};

/**
 * The poll floor under the daydream trail.
 *
 * Home Assistant pushes on GPS change, which is the high-fidelity path and the
 * one that carries the trail while you are moving. This exists for the two
 * cases that path cannot cover:
 *
 *  1. **Stillness.** The push only fires on movement, so a quiet afternoon
 *     produces no rows at all. Without a floor, "sat at home" and "phone off"
 *     look identical in the trail.
 *  2. **The link being down.** HA runs on homeserv; the site runs on the VPS.
 *     When homeserv is down the poll fails — and that failure is written as a
 *     `gap` row rather than skipped, because a detector must be able to tell
 *     "nothing happened" from "nobody was watching". Every "you have not left
 *     the house in three days" depends on that distinction being recorded.
 *
 * No LLM, so cost is zero and the cadence can be short.
 */
export const daydreamObserve: ActivityHandler = {
  name: NAME,
  description:
    'Poll floor for the daydream trail. Records where the whole household is in one Home Assistant round trip — the push stream only covers John — and records an explicit per-subject gap row when it looks and cannot see, so coverage is computable rather than assumed. No LLM.',
  // Same constant coverage divides by. Written once so they cannot drift.
  defaultCadenceSeconds: OBSERVE_CADENCE_SECONDS,
  defaultEnabled: true,
  // Deliberately 24/7: a trail with a nightly hole cannot answer "did he sleep
  // at home", and the gap rows would make that hole indistinguishable from an
  // outage.
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as ObserveConfig) };
    const subjects: SubjectEntity[] =
      cfg.subjects ??
      FAMILY_SUBJECTS.map((s) =>
        // The legacy personEntity override still steers the default subject.
        s.subject === DEFAULT_SUBJECT ? { ...s, entity: cfg.personEntity } : s,
      );

    // Unset/null means enabled, matching the self-improvement engine.
    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    // The push stream only carries the default subject, so only that subject
    // may stand down on its freshness — everyone else is poll-only.
    const due: SubjectEntity[] = [];
    for (const s of subjects) {
      const fresh =
        s.subject === DEFAULT_SUBJECT && (await hasFreshFix(cfg.pushFreshMins * 60_000, s.subject));
      if (!fresh) due.push(s);
    }
    if (due.length === 0) {
      return {
        outcome: 'ok',
        summary: `push stream fresh (<${cfg.pushFreshMins}m) — no poll needed`,
      };
    }

    const polled = await pollAllSubjects(due);

    const fixes: string[] = [];
    const gaps: string[] = [];
    const errors: string[] = [];
    const details: Record<string, unknown> = {};

    for (const s of due) {
      const res = polled.get(s.subject) ?? { error: 'not polled' };
      if ('error' in res) {
        // Not an error outcome: HA being unreachable from the VPS is an
        // ordinary recurring state, and marking it `error` would burn the
        // action's failure budget and eventually pause the one thing recording
        // that we cannot see. The gap row IS the result — one per subject,
        // because five people un-observed is five facts.
        await recordGap(res.error, s.subject);
        gaps.push(s.subject);
        details[s.subject] = { gap: true, reason: res.error.slice(0, 200) };
        continue;
      }
      try {
        const fix = await recordFix(res.fix, 'poll', s.subject);
        fixes.push(`${s.subject}${fix.isHome ? '@home' : fix.placeId ? '@place' : ''}`);
        details[s.subject] = {
          trailId: fix.id,
          mode: fix.mode,
          isHome: fix.isHome,
          placeId: fix.placeId,
        };
      } catch (err) {
        const reason = errMsg(err);
        await recordGap(`fix rejected: ${reason}`, s.subject);
        errors.push(`${s.subject}: ${reason.slice(0, 80)}`);
        details[s.subject] = { rejected: reason.slice(0, 200) };
      }
    }

    const bits: string[] = [];
    if (fixes.length) bits.push(`fixes: ${fixes.join(', ')}`);
    if (gaps.length) bits.push(`gaps: ${gaps.join(', ')}`);
    if (errors.length) bits.push(`rejected: ${errors.join('; ')}`);

    // Every fix rejected and none written is a fault; gaps alone are not.
    const outcome = errors.length > 0 && fixes.length === 0 ? 'error' : 'ok';
    return { outcome, summary: bits.join(' · ') || 'nothing to record', details };
  },
};
