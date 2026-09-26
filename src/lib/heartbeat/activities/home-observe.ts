import {
  hasFreshFix,
  pollAllSubjects,
  recordFix,
  recordGap,
} from '$lib/home/presence/observe';
import {
  DEFAULT_SUBJECT,
  OBSERVE_CADENCE_SECONDS,
  errMsg,
  type SubjectEntity,
} from '$lib/home/presence/types';
import { ingestCompanion, type CompanionResult } from '$lib/home/presence/companion';
import { lifeSubjects, listMembers, type HouseholdMember } from '$lib/home/presence/members';
import { deliverAlerts, runCrossings } from '$lib/home/presence/alerts';
import type { ActivityHandler } from '../types';

// The name is the heartbeat_actions row's identity: it stays 'daydream-observe'
// although the file moved, because renaming it would orphan the row.
const NAME = 'daydream-observe';

interface ObserveConfig {
  /** Stand down while the push stream is this fresh. */
  pushFreshMins?: number;
  /** Legacy single-entity override, honoured for the default subject. */
  personEntity?: string;
  /** Everyone to poll from HA. Defaults to the household's life360 members. */
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
export const homeObserve: ActivityHandler = {
  name: NAME,
  description:
    'Poll floor for the household trail. Records where every Life360 member is in one Home Assistant round trip — the push stream only covers John — with an explicit per-subject gap row when it looks and cannot see, then pulls the iPhone app\'s fixes from the pilot for companion members, then raises arrive/leave alerts to the people who follow them. No LLM.',
  // Same constant coverage divides by. Written once so they cannot drift.
  defaultCadenceSeconds: OBSERVE_CADENCE_SECONDS,
  defaultEnabled: true,
  // Deliberately 24/7: a trail with a nightly hole cannot answer "did he sleep
  // at home", and the gap rows would make that hole indistinguishable from an
  // outage.
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as ObserveConfig) };

    // Who is written from where. Only life360 members are polled from Home
    // Assistant — a companion or 'none' member never is, and neither is a
    // subject in `cfg.subjects` who is not a life360 member: choosing not to be
    // tracked has to mean it. If the members table cannot be read we do not
    // know who consented, so NOBODY is polled and the companion pull (which
    // cannot map an email to a person without it) is skipped too. That is
    // reported, not an error outcome: a transient DB hiccup must not burn the
    // action's failure budget.
    let members: HouseholdMember[];
    try {
      members = await listMembers();
    } catch (err) {
      const reason = errMsg(err).slice(0, 200);
      return {
        outcome: 'ok',
        summary: `members unreadable — nobody observed: ${reason.slice(0, 120)}`,
        details: { membersError: reason },
      };
    }
    const life = lifeSubjects(members);
    const lifeSet = new Set(life.map((s) => s.subject));
    const subjects: SubjectEntity[] = (cfg.subjects ?? life)
      .filter((s) => lifeSet.has(s.subject))
      .map((s) =>
        // The legacy personEntity override still steers the default subject.
        s.subject === DEFAULT_SUBJECT && !cfg.subjects ? { ...s, entity: cfg.personEntity } : s,
      );

    // The push stream only carries the default subject, so only that subject
    // may stand down on its freshness — everyone else is poll-only.
    const due: SubjectEntity[] = [];
    for (const s of subjects) {
      const fresh =
        s.subject === DEFAULT_SUBJECT && (await hasFreshFix(cfg.pushFreshMins * 60_000, s.subject));
      if (!fresh) due.push(s);
    }

    const fixes: string[] = [];
    const gaps: string[] = [];
    const errors: string[] = [];
    const details: Record<string, unknown> = {};
    const bits: string[] = [];

    if (due.length === 0 && subjects.length > 0) {
      bits.push(`push stream fresh (<${cfg.pushFreshMins}m) — no poll needed`);
    }

    const polled = due.length ? await pollAllSubjects(due) : new Map();

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

    // The iPhone app, through the pilot's household lane. Skipped silently
    // when no token is configured. A failure here is reported, not an error
    // outcome: the pilot being unreachable is as ordinary as HA being so, and
    // the cursor stays put so nothing is lost. No gap rows either — silence is
    // normal for a phone (a still phone is suspended), so it proves nothing.
    let companion: CompanionResult | null = null;
    try {
      companion = await ingestCompanion(members);
    } catch (err) {
      companion = { pages: 0, written: 0, dropped: 0, rejected: 0, skipped: 0, more: false, error: errMsg(err) };
    }
    if (companion) {
      details.companion = companion;
      const c = [`${companion.written} written`];
      if (companion.dropped) c.push(`${companion.dropped} unmapped`);
      if (companion.rejected) c.push(`${companion.rejected} rejected`);
      if (companion.skipped) c.push(`${companion.skipped} already written`);
      if (companion.more) c.push('more waiting');
      if (companion.error) c.push(`failed: ${companion.error.slice(0, 80)}`);
      bits.push(`companion: ${c.join(', ')}`);
    }

    // Arrivals and departures, from every trail row written since the last
    // run — this run's poll and app fixes, and the push stream's, which never
    // pass through here. Then delivery. Neither can fail the run: an alert
    // that did not go stays owed and is retried while it is under two hours
    // old.
    try {
      const crossings = await runCrossings(members);
      details.crossings = crossings;
      const c: string[] = [];
      if (crossings.written) c.push(`${crossings.written} new`);
      if (crossings.deduped) c.push(`${crossings.deduped} repeated`);
      if (crossings.initialised.length) c.push(`started watching ${crossings.initialised.join(', ')}`);
      if (crossings.errors.length) c.push(`failed: ${crossings.errors.join('; ').slice(0, 120)}`);
      if (c.length) bits.push(`crossings: ${c.join(', ')}`);
    } catch (err) {
      details.crossingsError = errMsg(err).slice(0, 200);
      bits.push(`crossings failed: ${errMsg(err).slice(0, 80)}`);
    }
    try {
      const sent = await deliverAlerts(members);
      details.alerts = sent;
      const a: string[] = [];
      if (sent.forwarded) a.push(`${sent.forwarded} to the app`);
      if (sent.pilotError) a.push(`app queue failed: ${sent.pilotError.slice(0, 80)}`);
      if (sent.whatsappSent.length) a.push(`WhatsApp to ${sent.whatsappSent.join(', ')}`);
      if (sent.whatsappFailed.length) a.push(`WhatsApp failed to ${sent.whatsappFailed.join(', ')}`);
      if (a.length) bits.push(`alerts: ${a.join(', ')}`);
    } catch (err) {
      details.alertsError = errMsg(err).slice(0, 200);
      bits.push(`alerts failed: ${errMsg(err).slice(0, 80)}`);
    }

    if (fixes.length) bits.push(`fixes: ${fixes.join(', ')}`);
    if (gaps.length) bits.push(`gaps: ${gaps.join(', ')}`);
    if (errors.length) bits.push(`rejected: ${errors.join('; ')}`);

    // Every polled fix rejected and none written is a fault; gaps alone are not.
    const outcome = errors.length > 0 && fixes.length === 0 ? 'error' : 'ok';
    return { outcome, summary: bits.join(' · ') || 'nothing to record', details };
  },
};
