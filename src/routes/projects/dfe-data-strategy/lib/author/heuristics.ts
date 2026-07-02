// heuristics.ts — deterministic per-section completeness checks for the Author's
// Verify tab. Cheap, instant, honest: each check states what it looked for so the
// writer can judge false positives themselves. The deeper judgement calls belong
// to the LLM review (author/review endpoint), not here.

import { htmlToText } from './serialize';
import type { SectionTemplate, StrategySection } from './templates';

export type HeuristicId = 'substance' | 'dates' | 'owner' | 'measurable' | 'evidence' | 'plain-english';

export interface HeuristicResult {
  id: HeuristicId;
  pass: boolean;
  note: string;
}

const META: Record<HeuristicId, { label: string }> = {
  substance: { label: 'Substance' },
  dates: { label: 'Timeframes' },
  owner: { label: 'Ownership' },
  measurable: { label: 'Measurable' },
  evidence: { label: 'Evidence' },
  'plain-english': { label: 'Plain English' },
};
export const HEURISTIC_LABELS = META;

const OWNER_RE =
  /\b(accountable|accountability|owner(?:s|ship)?|owns|responsib(?:le|ility)|SRO|steward(?:s|ship)?|chief data officer|CDO|director(?:ate)? of|led by)\b/i;
const DATE_RE = /\b(20\d{2}(?:[/–-]\d{2})?|Q[1-4]\s*20\d{2}|(?:spring|summer|autumn|winter)\s+20\d{2}|within \d+\s+(?:days|months|years)|first 100 days)\b/i;
const EVIDENCE_TEXT_RE = /\b(source|sources|evidence|according to|research|NAO|Ofsted|census|survey|framework|published|statistics)\b/i;

export function runHeuristics(section: StrategySection, template: SectionTemplate | null): HeuristicResult[] {
  const ids: HeuristicId[] = template?.heuristics?.length
    ? template.heuristics
    : (Object.keys(META) as HeuristicId[]);
  const text = htmlToText(section.html);
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const results: HeuristicResult[] = [];

  for (const id of ids) {
    switch (id) {
      case 'substance': {
        const pass = words.length >= 80;
        results.push({
          id,
          pass,
          note: pass ? `${words.length} words — substantial.` : `${words.length} words — a strong section usually needs 80+ to say anything binding.`,
        });
        break;
      }
      case 'dates': {
        const pass = DATE_RE.test(text);
        results.push({
          id,
          pass,
          note: pass ? 'Names at least one timeframe.' : 'No dates or timeframes found — when does any of this happen?',
        });
        break;
      }
      case 'owner': {
        const pass = OWNER_RE.test(text);
        results.push({
          id,
          pass,
          note: pass ? 'Names ownership or accountability.' : 'Nobody is named as accountable — who owns this?',
        });
        break;
      }
      case 'measurable': {
        // numbers that aren't just years: percentages, counts, targets
        const deYeared = text.replace(/\b(?:19|20)\d{2}(?:[/–-]\d{2})?\b/g, '');
        const pass = /%|\bper cent\b|\bpercent\b/i.test(text) || /\d/.test(deYeared);
        results.push({
          id,
          pass,
          note: pass ? 'Contains at least one number or target beyond a date.' : 'Nothing measurable — no numbers, percentages or targets.',
        });
        break;
      }
      case 'evidence': {
        const pass = /<a\s+href=/i.test(section.html) || EVIDENCE_TEXT_RE.test(text);
        results.push({
          id,
          pass,
          note: pass ? 'References evidence or sources.' : 'No links or evidence referenced — what grounds this section?',
        });
        break;
      }
      case 'plain-english': {
        const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0);
        const avg = sentences.length ? words.length / sentences.length : 0;
        const pass = sentences.length === 0 || avg <= 30;
        results.push({
          id,
          pass,
          note: pass
            ? `Average sentence ${Math.round(avg)} words — readable.`
            : `Average sentence ${Math.round(avg)} words — long sentences hide decisions; split them.`,
        });
        break;
      }
    }
  }
  return results;
}
