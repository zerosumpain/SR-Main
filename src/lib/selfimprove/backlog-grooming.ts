import type { WorkItem } from './board';
import type { ToolHealth } from './narrative';
import { subjectOverlap } from './narrative';
import { clusterSlug } from './cluster';

export interface GroomingSuggestion {
  id: string;
  itemId: string;
  kind: 'merge' | 'covered';
  targetId: string;
  targetTitle: string;
  targetHref: string | null;
  reason: string;
}

/** Subject similarity proposes a review, never proves identical requirements. */
export function suggestBacklogGrooming(items: WorkItem[], tools: ToolHealth[] = []): GroomingSuggestion[] {
  const waiting = items.filter((i) => !i.foldedInto && i.attempts === 0 &&
    ((i.source === 'backlog' && i.backlogStatus === 'open' && i.stage === 'accepted') ||
      (i.source === 'capability' && i.stage === 'proposed')))
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
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
      ...(!repair ? live.map((i) => ({ id: i.id, title: i.title, text: i.title, detail: i.detail,
        href: i.artifactHref, kind: 'covered' as const, evidence: 'A matching deliverable is recorded as live.' })) : []),
      ...(!repair ? tools.filter((t) => t.enabled && t.runCount > t.errorCount && t.errorCount / t.runCount < 0.25).map((t) => ({
        id: `tool:${t.name}`, title: t.name.replace(/_/g, ' '), text: `${t.name.replace(/_/g, ' ')} ${t.description ?? ''}`,
        detail: t.description ?? '', href: '/jkai/daydreams/improvement', kind: 'covered' as const,
        evidence: `Existing tool: ${t.runCount - t.errorCount} successful calls recorded.` })) : []),
      ...(item.source === 'backlog' ? waiting.slice(0, index).filter((i) => i.source === 'backlog' && !out.some((s) => s.itemId === i.id && s.kind === 'merge')).map((i) => ({
        id: i.id, title: i.title, text: i.title, detail: i.detail, href: null,
        kind: 'merge' as const, evidence: 'Another queued deliverable covers a similar request.' })) : []),
    ].map((c) => ({ ...c, score: score(item.title, c.text) })).filter((c) => c.score > 0)
      .sort((a, b) => Number(b.kind === 'covered') - Number(a.kind === 'covered') || b.score - a.score || a.id.localeCompare(b.id));
    const match = candidates[0];
    if (!match) continue;
    out.push({ id: clusterSlug([item.id, item.title, item.detail, JSON.stringify(item.grooming), match.id, match.text, match.detail]),
      itemId: item.id, kind: match.kind, targetId: match.id, targetTitle: match.title, targetHref: match.href,
      reason: `${match.evidence} Similarity is a suggestion; check the requirements before deciding.` });
  }
  return out;
}
