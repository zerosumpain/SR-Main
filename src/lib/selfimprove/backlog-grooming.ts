import type { WorkItem } from './board';
import type { ToolHealth } from './narrative';
import { subjectOverlap } from './narrative';
import { clusterSlug } from './cluster';

export interface GroomingSuggestion {
  automatic: boolean;
  id: string;
  itemId: string;
  kind: 'merge' | 'covered';
  targetId: string;
  targetTitle: string;
  targetHref: string | null;
  reason: string;
}

export interface GroomingAction {
  id: string;
  itemId: string;
  itemTitle: string;
  targetId: string;
  targetTitle: string;
  kind: 'merge' | 'covered';
  at: string;
  by: 'owner' | 'engine';
  state: 'pending' | 'applied' | 'undone';
}

/** Coverage requires the request's specific words to be present in the evidence. */
function requirementsCovered(request: string, existing: string): boolean {
  const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2 &&
    !['the', 'and', 'for', 'with', 'that', 'this', 'should', 'must', 'please', 'support', 'add', 'provide', 'allow', 'enable'].includes(w)) ?? [];
  const wanted = words(request);
  const available = new Set(words(existing));
  return wanted.length > 0 && wanted.every((w) => available.has(w));
}

/** Related work can share a brief; retiring work additionally requires coverage. */
export function suggestBacklogGrooming(items: WorkItem[], tools: ToolHealth[] = [], overrides: ReadonlySet<string> = new Set()): GroomingSuggestion[] {
  const waiting = items.filter((i) => !overrides.has(i.id) && !i.foldedInto && i.attempts === 0 &&
    ((i.source === 'backlog' && i.backlogStatus === 'open' && i.stage === 'accepted') ||
      (i.source === 'capability' && i.stage === 'proposed')))
    .sort((a, b) => Number(b.source === 'backlog') - Number(a.source === 'backlog') || a.priority - b.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const live = items.filter((i) => i.stage === 'live' && !i.foldedInto);
  const out: GroomingSuggestion[] = [];
  const score = (a: string, b: string) => {
    const m = subjectOverlap(a, b);
    return m.hits >= 3 && m.score >= 0.5 ? m.score : 0;
  };
  for (const [index, item] of waiting.entries()) {
    // A request to repair existing behaviour is not satisfied by its existence.
    const repair = ['fault', 'doctor', 'health'].includes(item.intake ?? '') || /\b(fix|repair|broken|failure|error|regression)\b/i.test(item.title);
    const candidates = [
      ...(!repair ? live.map((i) => ({ id: i.id, title: i.title, text: i.title, detail: [i.detail, JSON.stringify(i.grooming ?? {}), ...Object.values(i.absorbedRequirements ?? {})].join(' '),
        href: i.artifactHref, kind: 'covered' as const, evidence: 'A matching deliverable is recorded as live.' })) : []),
      ...(!repair ? tools.filter((t) => t.enabled && t.runCount > t.errorCount && t.errorCount / t.runCount < 0.25).map((t) => ({
        id: `tool:${t.name}`, title: t.name.replace(/_/g, ' '), text: `${t.name.replace(/_/g, ' ')} ${t.description ?? ''}`,
        detail: t.description ?? '', href: '/jkai/daydreams/improvement', kind: 'covered' as const,
        evidence: `Existing tool: ${t.runCount - t.errorCount} successful calls recorded.` })) : []),
      ...waiting.slice(0, index).filter((i) => (item.source === 'capability' || i.source === 'backlog') && i.kind === item.kind && !out.some((s) => s.itemId === i.id)).map((i) => ({
        id: i.id, title: i.title, text: i.title, detail: i.detail, href: null,
        kind: 'merge' as const, evidence: 'Another queued deliverable covers a similar request.' })),
    ].map((c) => ({ ...c, score: score(item.title, c.text) })).filter((c) => c.score > 0)
      .sort((a, b) => Number(b.kind === 'covered') - Number(a.kind === 'covered') || b.score - a.score || a.id.localeCompare(b.id));
    const match = candidates[0];
    if (!match) continue;
    const automatic = match.kind === 'merge' || (!repair && requirementsCovered(
      [item.title, item.detail, ...(item.grooming?.acceptanceCriteria ?? []), ...Object.values(item.absorbedRequirements ?? {})].join(' '),
      `${match.text} ${match.detail}`));
    out.push({ automatic, id: clusterSlug([item.id, item.title, item.detail, JSON.stringify(item.grooming), match.id, match.text, match.detail]),
      itemId: item.id, kind: match.kind, targetId: match.id, targetTitle: match.title, targetHref: match.href,
      reason: `${match.evidence} Related requirements are retained together; distinct functionality remains separately deliverable.` });
  }
  return out;
}
