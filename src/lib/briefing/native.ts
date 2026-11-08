// The phone's Morning report (`GET /api/native/briefing`): one stored
// briefing record mapped to the app's shape. PURE. Records written before
// 2026-10-27 carry no factors or connections and read as empty lists.

import { briefingDateLabel } from '$lib/constants/briefing';
import type { BriefingConnection, BriefingData, FactorCard } from './types';

export const NATIVE_DAYS_MAX = 14;
export const BRIEFING_PAGE_BASE = 'https://strangeramblings.com/jkai/daydreams/briefing';

const MODES = ['weekday', 'monday', 'weekend', 'travel'] as const;
export type BriefingMode = (typeof MODES)[number];

export interface NativeBriefing {
  day: string;
  title: string;
  dateLabel: string;
  generatedAt: string;
  headline: string;
  markdown: string;
  verified: boolean;
  mode: BriefingMode | null;
  factors: FactorCard[];
  connections: BriefingConnection[];
  gaps: Array<{ section: string; reason: string }>;
  daydreamsText: string;
  pageUrl: string;
  days: string[];
}

export const isBriefingDay = (v: string | null | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function labelFor(day: string): string {
  try {
    return briefingDateLabel(new Date(`${day}T12:00:00Z`));
  } catch {
    return day;
  }
}

export function toNativeBriefing(day: string, record: BriefingData, days: string[]): NativeBriefing {
  const detail = record.detail;
  const dateLabel = detail?.dateLabel || labelFor(day);
  const title = record.title || `Briefing — ${dateLabel}`;
  const mode = (MODES as readonly string[]).includes(detail?.mode ?? '') ? (detail!.mode as BriefingMode) : null;
  return {
    day,
    title,
    dateLabel,
    generatedAt: detail?.generatedAt || record.finishedAt || record.startedAt || '',
    headline: detail?.headline || title,
    markdown: record.markdown ?? '',
    // A record from before the draft check has no verdict; it claims none.
    verified: detail?.verification?.verified === true,
    mode,
    factors: Array.isArray(detail?.factors) ? detail.factors : [],
    connections: Array.isArray(detail?.connections) ? detail.connections : [],
    gaps: (Array.isArray(detail?.gaps) ? detail.gaps : []).map((g) => ({ section: g.section, reason: g.reason })),
    daydreamsText: detail?.daydreamsText ?? '',
    pageUrl: `${BRIEFING_PAGE_BASE}/${day}`,
    days,
  };
}
