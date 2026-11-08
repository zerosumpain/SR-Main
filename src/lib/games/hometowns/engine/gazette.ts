// The County Gazette's DATA (WP3, spec §9.9). At the County Week the engine
// writes a structured issue: story records with template keys, numbers and
// town indices. Copy (WP8, copy.ts) renders them at both levels, kid and
// adult, deterministically, with no LLM; this file never writes a sentence.
//
// Stories are ranked by newsworthiness: |change| ÷ that town's usual weekly
// change × a category weight, firsts ×3, and last week's leader's score
// halved so the biggest town rarely dominates. Every town gets at least one
// story. Items carry only numbers and strings (town indices, keys), so the
// issue is JSON-safe and identical wherever it is computed.

import { regionOf, rp } from './region-state';
import { COHORTS, type CountyState, type GazetteIssue, type MoveStory, type RegionalContext } from './types';

export type GazetteItem = GazetteIssue['items'][number];

export interface WeekNews {
  week: number;
  season: number;
  seasonWeek: number;
  awards: { town: number; award: string }[];
  mentions: { town: number; award: string }[];
  council: { question: string; choice: number } | null;
  nextQuestion: string | null;
  goals: { done: number; total: number; reward: string | null };
  fund: number[];
  festival: { host: number; kind: string } | null;
  seasonEnd: boolean;
}

interface Candidate {
  town: number;
  key: string;
  score: number;
  data: Record<string, number | string>;
}

/** Each town's candidate stories for the week, with newsworthiness scores. */
function candidates(c: CountyState, r: RegionalContext, news: WeekNews): Candidate[] {
  const g = regionOf(c);
  const q = rp(c);
  const out: Candidate[] = [];
  const since = r.dayIndex - 6;
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    if (t.archived) continue;
    const w = g.week[i];
    if (!w) continue;
    const usual = Math.max(10, g.usual[i] ?? 0);
    const dPop = w.pop1 - w.pop0;
    out.push({ town: i, key: dPop >= 0 ? 'gazette.grew' : 'gazette.shrank', score: Math.abs(dPop) / usual, data: { town: i, n: Math.abs(dPop), pop: w.pop1 } });
    const dMood = w.mood1 - w.mood0;
    if (Math.abs(dMood) >= 1) out.push({ town: i, key: dMood > 0 ? 'gazette.happier' : 'gazette.grumpier', score: (0.8 * Math.abs(dMood)) / 5, data: { town: i, n: Math.round(Math.abs(dMood)) } });
    for (const item of t.inbox) {
      if (item.day < since) continue;
      if (item.kind === 'promotion') out.push({ town: i, key: 'gazette.promoted', score: 2 * q.gazetteFirst, data: { town: i, tier: Number(item.data.tier ?? 0) } });
      if (item.kind === 'linkOpened') out.push({ town: i, key: 'gazette.linkOpened', score: 1.2, data: { town: i, with: Number(item.data.with ?? -1), kind: String(item.data.kind ?? 'road') } });
      if (item.kind === 'communitySpirit') out.push({ town: i, key: 'gazette.communitySpirit', score: 1.5, data: { town: i } });
      if (item.kind === 'ribbonGuest') out.push({ town: i, key: 'gazette.ribbon', score: 1, data: { town: i, guest: Number(item.data.with ?? -1) } });
    }
    for (const a of news.awards) if (a.town === i) out.push({ town: i, key: 'gazette.award', score: 1.5, data: { town: i, award: a.award } });
    for (const a of news.mentions) if (a.town === i) out.push({ town: i, key: 'gazette.mention', score: 1, data: { town: i, award: a.award } });
    // Every town has something to say: its own quiet week.
    out.push({ town: i, key: 'gazette.quietWeek', score: 0.01, data: { town: i, pop: w.pop1 } });
  }
  for (const x of out) if (x.town === g.leader) x.score *= q.gazetteLeader;
  // Stable order: score, then town, then key.
  return out.sort((a, b) => b.score - a.score || a.town - b.town || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function story(s: MoveStory): GazetteItem {
  return {
    key: 'gazette.moveStory',
    data: { from: s.from, to: s.to, cohort: COHORTS[s.cohort], n: s.n, reason1: s.reasons[0] ?? '', reason2: s.reasons[1] ?? '', strength: s.strength ?? '', action: s.action },
  };
}

/** Builds the week's issue and updates the newsworthiness memory (usual change, last week's leader). */
export function buildGazette(c: CountyState, r: RegionalContext, news: WeekNews): GazetteIssue {
  const g = regionOf(c);
  const items: GazetteItem[] = [];
  items.push({ key: 'gazette.masthead', data: { season: news.season, week: news.seasonWeek, issue: news.week } });
  const ranked = candidates(c, r, news);
  const lead = ranked[0];
  if (lead) items.push({ key: 'gazette.lead', data: { ...lead.data, story: lead.key } });
  // One headline per town: its best story that is not the lead.
  for (let i = 0; i < c.towns.length; i++) {
    if (c.towns[i].archived) continue;
    const best = ranked.find((x) => x.town === i && x !== lead) ?? (lead && lead.town === i ? lead : undefined);
    if (best && best !== lead) items.push({ key: 'gazette.headline', data: { ...best.data, story: best.key } });
  }
  // Around the County.
  for (const s of [...g.weekStories].sort((a, b) => b.n - a.n).slice(0, 4)) items.push(story(s));
  let commuters = 0;
  for (const f of c.flows.towns) for (const x of f.commutersIn) commuters += x;
  let trade = 0;
  for (const a of c.allocations) trade += a.units * a.price;
  items.push({ key: 'gazette.roundup', data: { commuters: Math.round(commuters), allocations: c.allocations.length, tradeValue: Math.round(trade) } });
  items.push({ key: 'gazette.goals', data: { done: news.goals.done, total: news.goals.total, reward: news.goals.reward ?? '' } });
  // County Fair.
  for (const a of news.awards) items.push({ key: 'gazette.awardWinner', data: { town: a.town, award: a.award } });
  for (const a of news.mentions) items.push({ key: 'gazette.editorsMention', data: { town: a.town, award: a.award } });
  if (news.council) items.push({ key: 'gazette.councilResult', data: { question: news.council.question, choice: news.council.choice } });
  if (news.nextQuestion) items.push({ key: 'gazette.councilQuestion', data: { question: news.nextQuestion } });
  news.fund.forEach((x, i) => {
    if (x > 0) items.push({ key: 'gazette.fundGrant', data: { town: i, amount: x } });
  });
  if (news.festival) items.push({ key: 'gazette.festival', data: { town: news.festival.host, kind: news.festival.kind } });
  if (news.seasonEnd) items.push({ key: 'gazette.seasonEnd', data: { season: news.season } });

  // Newsworthiness memory: each town's usual weekly change, and who led.
  for (let i = 0; i < c.towns.length; i++) {
    const w = g.week[i];
    if (!w) continue;
    const d = Math.abs(w.pop1 - w.pop0);
    g.usual[i] = Math.round(((g.usual[i] ?? 0) * 0.7 + d * 0.3) * 100) / 100;
  }
  g.leader = lead ? lead.town : -1;
  return { day: r.dayIndex, week: news.week, items };
}
