// regions.ts — the REGIONAL decomposition layer. The national engine is England-wide; this
// re-bases a national YearResult onto one of the 9 ONS English regions (or a coastal cross-cut)
// by adding research-calibrated OFFSETS, and lets place-based policy — `place_investment` and
// the two 2026 area missions (Mission North East, Mission Coastal) — differentially CLOSE the
// penalty of the worst regions. Pure-derive over the national SimResult; no engine state. Self-contained.
//
// CALIBRATION (offsets vs the national baseline; the pupilShare-weighted mean of each offset is
// re-centred to 0 in code, so the 9 regions always aggregate back to the national figure):
//   • Attainment 8 & % grade-5 E&M, KS4 disadvantage gap, persistent absence: DfE EES Key-Stage-4
//     2023/24 + EPI Annual Report 2025 regional gaps. The validated per-region A8 reproduces the
//     national 46.1 on the published pupil weights.
//   • The "North East puzzle" (EPI/Durham/NECA 2025): NE has a SMALLER gap at KS2 (9.5 vs 10.0mo)
//     but the WIDEST-widening to KS4 (21.6mo) and the lowest Attainment 8 (43.7).
//   • Persistent absence: London 17.9% (lowest) vs North East 22.1% (highest) [DfE absence 2023/24].
//   • Place-based attainment evidence is WEAK/contested (NAO 2024; Opportunity Areas process-only;
//     Hastings' KS4 gap actually WIDENED) — so closure is modelled SMALL, slow and capped, and
//     flagged as an assumption.

import type { YearResult } from '$lib/policy-engine/types';
import { LEVERS_BY_ID } from '$lib/policy-engine/levers';
import { GAP_TO_LEVEL } from '$lib/policy-engine/params';

export interface RegionDef {
  code: string;
  name: string;
  pupilShare: number; // fraction of England state pupils (sums to 1.00)
  gapOff: number;     // KS4 disadvantage gap offset, months (+ = wider)
  a8Off: number;      // Attainment 8 offset, points (+ = higher)
  paOff: number;      // persistent absence offset, pp (+ = worse)
  gldOff: number;     // GLD offset, pp (+ = higher)
  coastal: number;    // 0-1 share of the region that is coastal / seaside (assumption)
  note: string;
}

// 9 ONS regions. Offsets are pre-centre; the code re-centres on pupilShare so aggregation is exact.
export const REGIONS: RegionDef[] = [
  { code: 'LDN', name: 'London',                 pupilShare: 0.1473, gapOff: -8.9, a8Off: 4.7, paOff: -2.1, gldOff: 1.8, coastal: 0.00, note: 'The "London effect": by far the smallest disadvantage gap (KS4 ~10mo) and highest Attainment 8 (50.8).' },
  { code: 'SE',  name: 'South East',             pupilShare: 0.1598, gapOff: 3.0,  a8Off: 1.1, paOff: -1.2, gldOff: 1.0, coastal: 0.40, note: 'High average A8 (47.2) but the LARGEST absolute KS4 gap (~22mo) — affluence masks coastal cold-spots (Hastings, Kent coast).' },
  { code: 'EE',  name: 'East of England',        pupilShare: 0.1141, gapOff: -0.1, a8Off: -0.1, paOff: -0.8, gldOff: -0.3, coastal: 0.45, note: 'Near the national average overall; long coastline (Norfolk/Suffolk/Essex) with isolated low-attainment pockets.' },
  { code: 'SW',  name: 'South West',             pupilShare: 0.0925, gapOff: 1.9,  a8Off: -0.1, paOff: -0.5, gldOff: 0.3, coastal: 0.55, note: 'The most coastal/rural region (Cornwall, Devon); wide KS2 gap (12.5mo) and joint-worst 16-19 gap (4.2 grades).' },
  { code: 'EM',  name: 'East Midlands',          pupilShare: 0.0876, gapOff: 2.6,  a8Off: -1.3, paOff: 0.6,  gldOff: -0.4, coastal: 0.25, note: 'Below-average A8 (44.8) and one of the widest KS4 gaps (~21.7mo).' },
  { code: 'WM',  name: 'West Midlands',          pupilShare: 0.1135, gapOff: 0.1,  a8Off: -1.6, paOff: 0.7,  gldOff: -0.6, coastal: 0.00, note: 'Below-average attainment (A8 44.5) but a near-national gap; landlocked.' },
  { code: 'NW',  name: 'North West',             pupilShare: 0.1374, gapOff: 1.4,  a8Off: -1.8, paOff: 1.0,  gldOff: -1.2, coastal: 0.30, note: 'Large region, below-average A8 (44.3); the widest gap already at age 5 (EPI); Blackpool/Cumbria coast.' },
  { code: 'YH',  name: 'Yorkshire & The Humber', pupilShare: 0.1016, gapOff: 1.4,  a8Off: -1.9, paOff: 1.1,  gldOff: -0.6, coastal: 0.35, note: 'Low A8 (44.2); coastal cold-spots (Scarborough, Hull, Grimsby) — Scarborough is a Mission Coastal pilot.' },
  { code: 'NE',  name: 'North East',             pupilShare: 0.0463, gapOff: 2.5,  a8Off: -2.4, paOff: 2.1,  gldOff: 0.2, coastal: 0.35, note: 'Lowest A8 (43.7) and highest absence (22.1%); the "North East puzzle" — OK at primary, falls furthest by KS4. The Mission North East target.' },
];
export const REGIONS_BY_CODE: Record<string, RegionDef> = Object.fromEntries(REGIONS.map((r) => [r.code, r]));

// A coastal CROSS-CUT (not one of the 9 regions; overlaps them). Calibrated as a coastal-pupil-
// weighted blend of the regions PLUS an extra within-region coastal penalty (disadvantaged coastal
// pupils ~3 GCSE grades behind non-coastal — DfE 2019). Targeted by Mission Coastal.
export const COASTAL_CUT = {
  code: 'COAST', name: 'Coastal areas (cross-cut)',
  gapOff: 2.2, a8Off: -1.6, paOff: 0.9, gldOff: -0.6, coastal: 1.0,
  note: 'Seaside/coastal communities across all regions (Hastings, Scarborough, Blackpool, the South West…). A cross-cut, not a region — outcomes are hidden when merged with wealthier inland averages (CMO 2021).',
};

// ---- place-based closure: how much of a region's penalty place_investment + the missions remove ----
const PLACE_K = 0.22;   // max share of penalty closed by full place_investment (cold-spots) — small (weak evidence)
const NE_K = 0.34;      // extra closure for the North East at full Mission North East
const COAST_K = 0.32;   // extra closure (×coastal intensity) at full Mission Coastal
const CLOSURE_CAP = 0.55;
const CLOSURE_LAG = 5;  // years to ~63% of the (already small) closure — place-based effects are slow

const dep = (levers: Record<string, number>, id: string): number => {
  const L = LEVERS_BY_ID[id];
  if (!L) return 0;
  const v = levers[id] ?? L.baseline;
  const span = L.max - L.baseline;
  return span === 0 ? 0 : Math.max(0, (v - L.baseline) / span);
};
const ramp = (ys: number, lag: number) => 1 - Math.exp(-Math.max(0, ys) / Math.max(0.5, lag));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Per-region penalty-closure fraction [0, CLOSURE_CAP] in a given projection year. Cold-spots
 *  respond more (responsiveness scales with the region's gap penalty); London ~0 (not a target). */
function closureFor(r: { gapOff: number; coastal: number; code: string }, levers: Record<string, number>, ys: number): number {
  const resp = clamp(Math.max(0, r.gapOff) / 2.5, 0, 1.2);       // cold-spots (gapOff≥2.5) fully responsive
  const place = PLACE_K * dep(levers, 'place_investment');
  const ne = r.code === 'NE' ? NE_K * dep(levers, 'mission_ne') : 0;
  const coast = COAST_K * dep(levers, 'mission_coastal') * r.coastal;
  return clamp(resp * (place + ne + coast) * ramp(ys, CLOSURE_LAG), 0, CLOSURE_CAP);
}

/** Effective, re-centred offset for one metric across all regions, so Σ pupilShare·offset = 0.
 *  `badSign` says which sign is the penalty being closed ('pos' for gap/absence, 'neg' for A8/GLD). */
function centredOffsets(pick: (r: RegionDef) => number, badSign: 'pos' | 'neg', levers: Record<string, number>, ys: number): Record<string, number> {
  const raw: Record<string, number> = {};
  for (const r of REGIONS) {
    const off = pick(r);
    const c = closureFor(r, levers, ys);
    const isPenalty = badSign === 'pos' ? off > 0 : off < 0;
    raw[r.code] = isPenalty ? off * (1 - c) : off;
  }
  const wMean = REGIONS.reduce((s, r) => s + r.pupilShare * raw[r.code], 0);
  const out: Record<string, number> = {};
  for (const r of REGIONS) out[r.code] = raw[r.code] - wMean;
  return out;
}

// coastal pupils as a share of England (Σ pupilShare × coastal intensity) — the scale for the cross-cut
export const COASTAL_SHARE = REGIONS.reduce((s, r) => s + r.pupilShare * r.coastal, 0); // ≈ 0.28

/** The pupil-share that scales population headcount denominators for a geographic view (1 = England). */
export function regionScale(code: string): number {
  if (code === 'all') return 1;
  if (code === 'COAST') return COASTAL_SHARE;
  return REGIONS_BY_CODE[code]?.pupilShare ?? 1;
}

// Regional earnings relative to England (≈ ONS ASHE median gross weekly pay, 2024-ish).
// Scales the LEO monetisation when a region is selected — a London A8 point is worth
// more in £ than a North East one, because the wage distribution it feeds differs.
const EARNINGS_IDX: Record<string, number> = {
  LDN: 1.25, SE: 1.06, EE: 1.00, SW: 0.93, EM: 0.91, WM: 0.93, NW: 0.93, YH: 0.90, NE: 0.88,
  COAST: 0.90, // coastal cross-cut: blended, below-average wage areas
};

/** Earnings factor for the LEO monetisation in a geographic view (1 = England). */
export function regionEarnings(code: string): number {
  if (code === 'all') return 1;
  return EARNINGS_IDX[code] ?? 1;
}

export interface RegionView { code: string; name: string; isCut: boolean; }
export const REGION_OPTIONS: RegionView[] = [
  { code: 'all', name: 'England (all)', isCut: false },
  ...REGIONS.map((r) => ({ code: r.code, name: r.name, isCut: false })),
  { code: 'COAST', name: COASTAL_CUT.name, isCut: true },
];

/** Apply a region's effective offsets to one national YearResult. */
function applyOffsets(nat: YearResult, off: { gap: number; a8: number; pa: number; gld: number }): YearResult {
  const gapKS4 = clamp(nat.gapKS4 + off.gap, 0.5, 30);
  const attainment8 = clamp(nat.attainment8 + off.a8, 20, 70);
  const grade5EM = clamp(nat.grade5EM + 2.2 * off.a8, 5, 95);
  const persistentAbsence = clamp(nat.persistentAbsence + off.pa, 3, 45);
  const gld = clamp(nat.gld + off.gld, 40, 95);
  // worse attainment → more NEET (engine's neetPerA8 ≈ 0.25pp per A8 point + regional labour-market residual)
  const neet = clamp(nat.neet - 0.35 * off.a8, 5, 30);
  // the three segments scale proportionally so they always sum to the regional headline
  const nf = nat.neet > 0 ? neet / nat.neet : 1;
  return {
    ...nat,
    gapKS4, attainment8, grade5EM, gld, persistentAbsence,
    persistentAbsenceDis: clamp(nat.persistentAbsenceDis + off.pa * 1.3, 5, 50),
    severeAbsence: clamp(nat.severeAbsence + off.pa * 0.25, 0.2, 10),
    // disadvantaged sub-levels re-derived from the REGIONAL gap (keeps the region internally consistent)
    attainment8Dis: clamp(attainment8 - GAP_TO_LEVEL.ks4A8 * gapKS4, 15, 70),
    grade5EMDis: clamp(grade5EM - GAP_TO_LEVEL.ks4G5 * gapKS4, 2, 95),
    gldDis: clamp(gld - (nat.gld - nat.gldDis), 25, 95),
    neet,
    neetUnemployed: nat.neetUnemployed * nf,
    neetInactiveHealth: nat.neetInactiveHealth * nf,
    neetInactiveOther: nat.neetInactiveOther * nf,
    neetLongTerm: nat.neetLongTerm * nf,
  };
}

/** Re-base a full national projection onto a region (or the coastal cross-cut). `all` returns the input. */
export function regionalise(years: YearResult[], code: string, levers: Record<string, number>): YearResult[] {
  if (code === 'all' || !years.length) return years;
  const baseYear = years[0].year;

  if (code === 'COAST') {
    return years.map((nat) => {
      const ys = nat.year - baseYear;
      const c = closureFor(COASTAL_CUT, levers, ys);
      return applyOffsets(nat, {
        gap: COASTAL_CUT.gapOff * (1 - c), a8: COASTAL_CUT.a8Off * (1 - c),
        pa: COASTAL_CUT.paOff * (1 - c), gld: COASTAL_CUT.gldOff * (1 - c),
      });
    });
  }

  const r = REGIONS_BY_CODE[code];
  if (!r) return years;
  return years.map((nat) => {
    const ys = nat.year - baseYear;
    const gap = centredOffsets((x) => x.gapOff, 'pos', levers, ys)[code];
    const a8 = centredOffsets((x) => x.a8Off, 'neg', levers, ys)[code];
    const pa = centredOffsets((x) => x.paOff, 'pos', levers, ys)[code];
    const gld = centredOffsets((x) => x.gldOff, 'neg', levers, ys)[code];
    return applyOffsets(nat, { gap, a8, pa, gld });
  });
}

/** One row per region for the geographic breakdown (map + bars) at a given national year. */
export interface RegionSnapshot {
  code: string; name: string; pupilShare: number; coastal: number; note: string;
  gapKS4: number; attainment8: number; grade5EM: number; persistentAbsence: number; neet: number; gld: number;
  gapBase: number;        // gap with no place-based policy (for the "closed by missions" delta)
  closure: number;        // fraction of penalty closed this year
}

export function regionalSnapshot(natRow: YearResult, natBaseRow: YearResult, levers: Record<string, number>, baselineLevers: Record<string, number>, ys: number): RegionSnapshot[] {
  const gapOff = centredOffsets((x) => x.gapOff, 'pos', levers, ys);
  const a8Off = centredOffsets((x) => x.a8Off, 'neg', levers, ys);
  const paOff = centredOffsets((x) => x.paOff, 'pos', levers, ys);
  const gldOff = centredOffsets((x) => x.gldOff, 'neg', levers, ys);
  const gapOffNoPolicy = centredOffsets((x) => x.gapOff, 'pos', baselineLevers, ys);
  return REGIONS.map((r) => {
    const row = applyOffsets(natRow, { gap: gapOff[r.code], a8: a8Off[r.code], pa: paOff[r.code], gld: gldOff[r.code] });
    return {
      code: r.code, name: r.name, pupilShare: r.pupilShare, coastal: r.coastal, note: r.note,
      gapKS4: row.gapKS4, attainment8: row.attainment8, grade5EM: row.grade5EM,
      persistentAbsence: row.persistentAbsence, neet: row.neet, gld: row.gld,
      gapBase: clamp(natBaseRow.gapKS4 + gapOffNoPolicy[r.code], 0.5, 30),
      closure: closureFor(r, levers, ys),
    };
  });
}
