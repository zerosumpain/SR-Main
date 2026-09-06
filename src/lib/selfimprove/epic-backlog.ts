import type { GroomingSuggestion } from './backlog-grooming';
import type { WorkItem, WorkStage } from './board';
import type { EpicData } from './types';
import { clusterSlug, labelFor } from './cluster';
import { looksSameSubject, subjectOverlap } from './narrative';

export interface BacklogEpic {
  suggestions?: GroomingSuggestion[];
  slug: string;
  title: string;
  summary: string;
  priority: number;
  stage: WorkStage;
  deliverables: WorkItem[];
  combinedDeliveries: WorkItem[];
  categories: string[];
  completed: number;
  updatedAt: string;
}

/** Provider aliases refer to one functional area, not to everything from a vendor. */
function calendarTopic(title: string): string | null {
  const t = title.toLowerCase();
  if (/\b(apple|icloud|caldav)\b/.test(t) && /\b(calendar|calendars|caldav)\b/.test(t)) return 'Apple Calendar integration';
  return null;
}
function related(a: string, b: string): number {
  const topic = calendarTopic(a);
  if (topic && topic === calendarTopic(b)) return 2;
  return looksSameSubject(a, b) ? subjectOverlap(a, b).score : 0;
}

/** One automatically maintained epic per functional area; work keeps its own lifecycle.
 * Existing memberships and IDs survive later arrivals. Match against a group's anchor
 * rather than chaining through every member, which joins unrelated subjects together.
 */
export function buildEpicBacklog(items: WorkItem[], saved: EpicData[] = []): BacklogEpic[] {
  // Legacy combined build rows are execution receipts, not an extra deliverable.
  const combined = new Map(items.filter((i) => i.mergedBrief && items.some((child) => child.foldedInto === i.slug)).map((i) => [i.slug, i]));
  const deliverables = items.filter((i) => !combined.has(i.slug)).map((i) => {
    const parent = i.foldedInto ? combined.get(i.foldedInto) : null;
    return parent ? { ...i, stage: parent.stage, priority: parent.priority, epicSlug: parent.epicSlug, updatedAt: parent.updatedAt } : i;
  });
  const ordered = [...deliverables].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const metadata = new Map(saved.map((e) => [e.slug, e]));
  const membership = new Map([...saved].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).flatMap((e) => (e.deliverableIds ?? []).map((id) => [id, e.slug] as const)));
  const groups = new Map<string, WorkItem[]>();
  const pending: WorkItem[] = [];
  for (const item of ordered) {
    const key = membership.get(item.id) ?? (item.epicSlug && metadata.has(item.epicSlug) ? item.epicSlug : null);
    if (key) groups.set(key, [...(groups.get(key) ?? []), item]);
    else pending.push(item);
  }
  // A linked capability may become a backlog deliverable: retain its epic identity.
  for (const item of pending) {
    const inherited = item.capabilitySlug ? membership.get(`capability:${item.capabilitySlug}`) : null;
    const foldedParent = item.foldedInto ? items.find((i) => i.slug === item.foldedInto) : null;
    let target = inherited ?? (foldedParent ? membership.get(foldedParent.id) : null);
    let best = 0;
    if (!target) for (const [slug, members] of groups) {
      const score = related(item.title, members[0].title);
      if (score > best) { best = score; target = slug; }
    }
    target ??= clusterSlug([item.id]);
    groups.set(target, [...(groups.get(target) ?? []), item]);
  }
  // Older accepted groupings may cover the same functionality. Automatically join
  // those containers too, keeping the oldest identity and every deliverable.
  const joined: Array<[string, WorkItem[]]> = [];
  for (const [slug, members] of groups) {
    const existing = joined.find(([, group]) => related(group[0].title, members[0].title) > 0);
    if (existing) existing[1].push(...members);
    else joined.push([slug, [...members]]);
  }
  return joined.map(([slug, members]) => {
    const meta = metadata.get(slug);
    const active = members.filter((i) => !i.foldedInto || combined.has(i.foldedInto));
    const stage: WorkStage = active.some((i) => i.stage === 'building') ? 'building'
      : active.some((i) => i.stage === 'accepted') ? 'accepted'
      : active.some((i) => i.stage === 'proposed') ? 'proposed'
      : active.some((i) => i.stage === 'verifying') ? 'verifying'
      : active.some((i) => i.stage === 'live') ? 'live' : 'parked';
    return {
      slug, title: meta?.ownerTitle ?? calendarTopic(members[0].title) ?? labelFor(members.map((i) => i.title)).replace(/^Epic:\s*/i, ''),
      summary: meta?.summary ?? '', priority: Math.min(...(active.length ? active : members).map((i) => i.priority)),
      stage, deliverables: members, combinedDeliveries: [...new Set(members.map((i) => i.foldedInto))].flatMap((slug) => slug && combined.has(slug) ? [combined.get(slug)!] : []), categories: [...new Set(members.map((i) => i.kind))].sort(),
      completed: active.filter((i) => i.stage === 'live').length,
      updatedAt: members.reduce((latest, i) => i.updatedAt > latest ? i.updatedAt : latest, ''),
    };
  }).sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
}
