/** A model proposes explanations and evidence needs, never a statistical verdict. */
export interface EvidenceNeed {
  need: string;
  reason: string;
  route: 'lookup' | 'observe' | 'ask' | 'connect' | 'build';
  acceptance: string;
}

export interface InvestigationPlan {
  benefit: string;
  alternatives: string[];
  support: string;
  contradict: string;
  missingEvidence: EvidenceNeed[];
}

const ROUTES = new Set(['lookup', 'observe', 'ask', 'connect', 'build']);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 400;

export function parseInvestigationPlan(raw: unknown): InvestigationPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!text(p.benefit) || !text(p.support) || !text(p.contradict)) return null;
  if (!Array.isArray(p.alternatives) || p.alternatives.length < 1 || p.alternatives.length > 4 || !p.alternatives.every(text)) return null;
  if (!Array.isArray(p.missingEvidence) || p.missingEvidence.length > 4) return null;
  const missingEvidence: EvidenceNeed[] = [];
  for (const rawNeed of p.missingEvidence) {
    if (!rawNeed || typeof rawNeed !== 'object') return null;
    const n = rawNeed as Record<string, unknown>;
    if (!text(n.need) || !text(n.reason) || !text(n.acceptance) || typeof n.route !== 'string' || !ROUTES.has(n.route)) return null;
    missingEvidence.push({ need: n.need.trim(), reason: n.reason.trim(), acceptance: n.acceptance.trim(), route: n.route as EvidenceNeed['route'] });
  }
  return { benefit: p.benefit.trim(), support: p.support.trim(), contradict: p.contradict.trim(), alternatives: p.alternatives.map((a) => a.trim()), missingEvidence };
}

/** Only development needs enter self-improvement. Waiting and questions are not builds. */
export function developmentNeeds(plan: InvestigationPlan): EvidenceNeed[] {
  return plan.missingEvidence.filter((n) => n.route === 'build' || n.route === 'connect');
}
