// The Morning Bulletin (WP3, spec §8.3 step 10, §9.9): after each Regional
// Day every town gets three headlines (the migration result, the biggest
// change, and tomorrow's announced event when there is one), as copy keys
// with data. Copy (WP8) words them; the adapter chooses the day's push from
// the inbox (push.ts, A29: never from a late Regional Day), so nothing here
// decides who is rung.
//
// This step also publishes WP3's additions to the snapshot that step 9 has
// just frozen (the contracts running tomorrow, for WP2a's utilities) and
// sends ribbon-cutting invitations for today's promotions.

import { population } from './core';
import { eventAt } from './world';
import { inviteRibbon, runningContracts } from './offers';
import { readHistory } from './records';
import { isActive, pp, regionOf } from './region-state';
import { COHORTS, type BulletinItem, type CountyState, type RegionalContext } from './types';

/** STEP §8.3 10 (WP3): the Morning Bulletin, and WP3's snapshot additions. */
export function stepBulletin(c: CountyState, r: RegionalContext): void {
  const g = regionOf(c);
  const p = pp(c);
  c.snapshot.contracts = runningContracts(c, r.dayIndex).map((k) => ({ ...k }));

  const today = c.snapshot.event?.id ?? null;
  const next = eventAt(c.seed, r.month + 12, p);
  const tomorrow = next && next.id !== today ? next.id : null;

  while (c.bulletin.length < c.towns.length) c.bulletin.push([]);
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    if (t.archived) {
      c.bulletin[i] = [];
      continue;
    }
    for (const item of t.inbox) if (item.kind === 'promotion' && item.day === r.dayIndex) inviteRibbon(c, i, r.dayIndex, `tier${String(item.data.tier ?? '')}`);
    const out: BulletinItem[] = [];
    if (!isActive(t)) {
      out.push({ key: 'bulletin.founded', data: {} });
      c.bulletin[i] = out;
      continue;
    }
    // 1. The migration result: the day's population change, and who moved between players.
    const days = g.popDays[i] ?? [];
    const pop = population(t);
    const before = days.length >= 2 ? days[days.length - 2] : pop;
    const d = pop - before;
    out.push(d > 0 ? { key: 'bulletin.grew', data: { n: d, pop } } : d < 0 ? { key: 'bulletin.shrank', data: { n: -d, pop } } : { key: 'bulletin.steady', data: { pop } });
    const came = g.stories.filter((s) => s.to === i).sort((a, b) => b.n - a.n)[0];
    const left = g.stories.filter((s) => s.from === i).sort((a, b) => b.n - a.n)[0];
    const story = left && (!came || left.n >= came.n) ? left : came;
    if (story) out.push({ key: 'bulletin.moveStory', data: { from: story.from, to: story.to, cohort: COHORTS[story.cohort], n: story.n, reason1: story.reasons[0] ?? '', strength: story.strength ?? '', action: story.action } });
    // 2. The biggest change: a promotion beats money.
    const promo = t.inbox.find((x) => x.kind === 'promotion' && x.day === r.dayIndex);
    if (promo) out.push({ key: 'bulletin.tierUp', data: { tier: Number(promo.data.tier ?? t.tier) } });
    else {
      const money = readHistory(t, 'reserves', true);
      const dm = money.length >= 2 ? money[money.length - 1] - money[money.length - 2] : 0;
      if (dm !== 0) out.push({ key: dm > 0 ? 'bulletin.money' : 'bulletin.moneyDown', data: { amount: Math.abs(dm) } });
    }
    if (out.length < 3 && !story) out.push({ key: 'bulletin.quiet', data: {} });
    const three = out.slice(0, 3);
    // 3. Tomorrow's announced event.
    if (tomorrow) three.push({ key: 'bulletin.tomorrow', data: { event: tomorrow } });
    c.bulletin[i] = three;
  }
}
