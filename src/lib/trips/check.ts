// src/lib/trips/check.ts
//
// The check-and-correct pass (v2.1). After a turn's ops are applied and the
// trip re-solved, the planner is shown what the person asked for and a compact
// before/after of the days that changed — active minutes, end time, stops
// added and removed, wishes dropped — and either confirms or issues ONE round
// of corrective ops. Its reply must say plainly if the request could not be
// fully met, and why. This is what catches "make Wednesday lighter" producing
// a Wednesday that is no lighter. PURE.

import { dayLabel } from './changes';
import type { PlannedDay, SolvedPlan, TripOp } from './model';
import { describeOp } from './ops';

export interface DaySnapshot {
  /** Minutes at stops and travelling between them — waits and free time excluded. */
  activeMin: number;
  /** When the day ends: arrival back at the stay, else the last departure. */
  endMin: number | null;
  stops: string[];
}

export interface DayChange {
  date: string;
  before: DaySnapshot | null;
  after: DaySnapshot | null;
  added: string[];
  removed: string[];
}

export interface TurnDiff {
  days: DayChange[];
  /** Wishes now planned on a different day than before — often a side effect the person did not ask for. */
  moved: Array<{ wishId: string; title: string; from: string; to: string }>;
  newlyDropped: Array<{ title: string; reason: string }>;
  noLongerDropped: string[];
}

export function daySnapshot(day: PlannedDay): DaySnapshot {
  const visits = day.stops.filter((s) => s.kind !== 'stay');
  const visitMin = visits.reduce((sum, s) => sum + Math.max(0, s.departMin - s.arriveMin - Math.round(s.waitSec / 60)), 0);
  const travelMin = day.legs.reduce((sum, l) => sum + Math.round(l.durationSec / 60), 0);
  const last = day.stops.at(-1);
  return {
    activeMin: visitMin + travelMin,
    endMin: last ? (last.kind === 'stay' ? last.arriveMin : last.departMin) : null,
    stops: visits.map((s) => s.title),
  };
}

const same = (a: DaySnapshot | null, b: DaySnapshot | null) =>
  !!a && !!b && a.activeMin === b.activeMin && a.endMin === b.endMin && a.stops.join('|') === b.stops.join('|');

/** The days a turn changed, and what changed in the dropped list. */
export function turnDiff(before: SolvedPlan | null, after: SolvedPlan, titles: Record<string, string> = {}): TurnDiff {
  const dates = [...new Set([...(before?.days ?? []).map((d) => d.date), ...after.days.map((d) => d.date)])].sort();
  const days: DayChange[] = [];
  for (const date of dates) {
    const b = before?.days.find((d) => d.date === date);
    const a = after.days.find((d) => d.date === date);
    const sb = b ? daySnapshot(b) : null;
    const sa = a ? daySnapshot(a) : null;
    if (same(sb, sa)) continue;
    days.push({
      date,
      before: sb,
      after: sa,
      added: (sa?.stops ?? []).filter((s) => !(sb?.stops ?? []).includes(s)),
      removed: (sb?.stops ?? []).filter((s) => !(sa?.stops ?? []).includes(s)),
    });
  }
  const was = new Set((before?.dropped ?? []).map((d) => d.wishId));
  const now = new Set(after.dropped.map((d) => d.wishId));
  const name = (id: string) => titles[id] ?? id;
  const dayOf = (plan: SolvedPlan | null) => {
    const m = new Map<string, { date: string; title: string }>();
    for (const d of plan?.days ?? []) for (const st of d.stops) if (st.wishId) m.set(st.wishId, { date: d.date, title: st.title });
    return m;
  };
  const was2 = dayOf(before);
  const moved: TurnDiff['moved'] = [];
  for (const [wishId, a] of dayOf(after)) {
    const b = was2.get(wishId);
    if (b && b.date !== a.date) moved.push({ wishId, title: titles[wishId] ?? a.title, from: b.date, to: a.date });
  }
  moved.sort((x, y) => (x.title < y.title ? -1 : x.title > y.title ? 1 : 0));
  return {
    days,
    moved,
    newlyDropped: after.dropped.filter((d) => !was.has(d.wishId)).map((d) => ({ title: name(d.wishId), reason: d.reason })),
    noLongerDropped: [...was].filter((id) => !now.has(id)).map(name),
  };
}

const hhmm = (m: number | null) => (m === null ? '—' : `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const hm = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

/** The diff as a few lines the model reads. */
export function diffText(diff: TurnDiff): string {
  if (!diff.days.length && !diff.newlyDropped.length && !diff.noLongerDropped.length && !diff.moved.length) return 'The schedule did not change.';
  const lines = diff.days.map((d) => {
    const b = d.before;
    const a = d.after;
    const parts = [
      `${dayLabel(d.date)} (${d.date}): active ${b ? hm(b.activeMin) : '—'} → ${a ? hm(a.activeMin) : '—'}, ends ${hhmm(b?.endMin ?? null)} → ${hhmm(a?.endMin ?? null)}`,
    ];
    if (d.added.length) parts.push(`added ${d.added.join(', ')}`);
    if (d.removed.length) parts.push(`removed ${d.removed.join(', ')}`);
    return parts.join('; ');
  });
  if (diff.moved.length) {
    lines.push(`Moved to another day: ${diff.moved.map((m) => `${m.title} [${m.wishId}] ${dayLabel(m.from)} (${m.from}) → ${dayLabel(m.to)} (${m.to})`).join('; ')}`);
  }
  if (diff.newlyDropped.length) lines.push(`Newly not planned: ${diff.newlyDropped.map((d) => `${d.title} (${d.reason})`).join('; ')}`);
  if (diff.noLongerDropped.length) lines.push(`Planned again: ${diff.noLongerDropped.join(', ')}`);
  return lines.join('\n');
}

export const CHECK_SYSTEM = `You are the trip planner checking your own work. You changed a trip through operations and the solver re-planned it. You are given what the person asked, what you told them, the operations that were applied, and how the schedule actually changed (per day: active time, end time, stops added and removed; wishes newly not planned).

Decide whether the result really does what they asked ("lighter" means less active time or an earlier end; "add X on Thursday" means X is on Thursday's list; and so on), and whether it did anything they did NOT ask for. In particular, a wish "moved to another day" that the request was not about is a side effect: pin it back to its old day with {"op":"updateWish","id","fields":{"fixedDate":"<old date>"}} if it still fits, or say plainly in the reply that it moved and why.
- If it does: {"ok": true, "reply": your reply to the person (you may tighten the first one so it matches what actually happened), "ops": []}.
- If it does not and another change would fix it: {"ok": false, "reply": a reply describing what you are now doing, "ops": [one round of corrective ops, same format as before]}. You get ONE round; no further check follows.
- If it cannot be met (a booked slot, opening hours, too little time): {"ok": false, "reply": say plainly what could not be done and why, and offer an alternative, "ops": []}.
The reply must never claim something the schedule does not show. British English, short, no emoji.
Answer ONLY with JSON: {"ok": boolean, "reply": string, "ops": Op[]}`;

export function checkPrompt(input: { request: string; firstReply: string; applied: TripOp[]; diff: TurnDiff; titles: Record<string, string> }): string {
  return [
    `What they asked: ${input.request}`,
    `What you told them: ${input.firstReply}`,
    `Operations applied: ${input.applied.length ? input.applied.map((o) => describeOp(o, input.titles)).join(' ') : 'none'}`,
    '',
    'How the schedule changed:',
    diffText(input.diff),
  ].join('\n');
}

export function readCheck(raw: unknown): { ok: boolean; reply: string | null; ops: unknown[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const reply = typeof r.reply === 'string' && r.reply.trim() ? r.reply.trim().slice(0, 4000) : null;
  const ops = Array.isArray(r.ops) ? r.ops : [];
  return { ok: r.ok === true && !ops.length, reply, ops };
}
