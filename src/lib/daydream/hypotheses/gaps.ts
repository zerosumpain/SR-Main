import { desc, inArray, isNotNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamHypotheses } from '$lib/db/schema';
import { developmentNeeds, parseInvestigationPlan } from './plan';
import type { PackFact } from '../appetite/spec';

/** Stable references carry the originating question through capability intake. */
export async function investigationGapFacts(): Promise<PackFact[]> {
  const rows = await db.select().from(daydreamHypotheses)
    .where(isNotNull(daydreamHypotheses.investigationPlan))
    .orderBy(desc(daydreamHypotheses.proposedAt)).limit(40);
  return rows.flatMap((h) => {
    if (h.feedback === 'not_useful') return [];
    const plan = parseInvestigationPlan(h.investigationPlan);
    if (!plan) return [];
    return developmentNeeds(plan).map((n, i) => ({
      key: `investigation:${h.id}:${i}`,
      text: `${h.subject}: ${h.question} [${h.verdict ?? 'unexamined'}]. Missing: ${n.need}. Why: ${n.reason}. Benefit: ${plan.benefit}. Acceptance: ${n.acceptance}. Route: ${n.route}. This is an evidence request, not an established finding or an access grant.`,
    }));
  }).slice(0, 12);
}

/** Re-read original requirements; do not rely on a capability model paraphrasing them. */
export async function investigationRequirements(cites: string[]): Promise<string> {
  const ids = [...new Set(cites.filter((c) => c.startsWith('investigation:')).map((c) => c.split(':')[1]))].filter(Boolean);
  if (!ids.length) return '';
  const rows = await db.select().from(daydreamHypotheses).where(inArray(daydreamHypotheses.id, ids));
  return rows.map((h) => {
    const plan = parseInvestigationPlan(h.investigationPlan);
    if (!plan) return '';
    const needs = developmentNeeds(plan).filter((_, i) => cites.includes(`investigation:${h.id}:${i}`));
    if (!needs.length) return '';
    return `Investigation ${h.id}: ${h.question}. ${needs.map((n) => `Evidence: ${n.need}. Acceptance: ${n.acceptance}.`).join(' ')} After usable observations arrive, rerun this investigation and compare its recorded assessments. Creating a tool or PR alone does not demonstrate the benefit. A connection requires separately granted access.`;
  }).filter(Boolean).join('\n');
}
