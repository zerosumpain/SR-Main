// src/lib/health/methodology.ts
export type MethodologyEntry = {
  id: string;            // 'sri', 'acwr', etc. — used as deep-link anchor
  metric: string;        // 'Sleep Regularity Index'
  cite: string;          // 'Phillips 2017'
  formula: string;       // markdown
  sourceData: string;    // 'Whoop sleep events, 14d window'
  caveats: string;       // markdown
  reference: string;     // 'Phillips et al., Scientific Reports 7:3216 (2017). https://doi.org/10.1038/s41598-017-03171-4'
};

export const METHODOLOGY: MethodologyEntry[] = [
  {
    id: 'readiness',
    metric: 'Readiness',
    cite: 'composite',
    formula: 'weighted mean of recovery (40%), HRV trend (20%), sleep quality (25%), load balance (15%) — clipped to 0–100',
    sourceData: 'Whoop recovery, Whoop HRV, Whoop sleep performance, ACWR (Whoop strain).',
    caveats: 'Composite score. The factor with the lowest value usually drives the colour band. See each factor for its own evidence.',
    reference: 'Internal composite. No single citation.',
  },
  {
    id: 'autonomic-balance',
    metric: 'Autonomic Balance',
    cite: 'Plews 2013',
    formula: 'composite z-score of HRV-rmssd 7d trend (positive) and resting heart rate 7d trend (negative), normalised against 28d personal baseline. Output mapped to 0–100.',
    sourceData: 'Whoop hrv_rmssd and resting_heart_rate from `whoop_recovery` (last 28 days).',
    caveats: 'Personal baselines drift over months. Below ~30 sustained for >5 days is the early-warning band — investigate sleep, illness, alcohol, stress.',
    reference: 'Plews DJ et al., Sports Med 43:773–781 (2013). Heart rate variability in elite triathletes — is variation in variability the key?',
  },
  {
    id: 'acwr',
    metric: 'ACWR — Acute:Chronic Workload Ratio',
    cite: 'Gabbett 2016',
    formula: 'acute = 7-day exponentially-weighted moving average of daily strain. chronic = 28-day EWMA. ratio = acute / chronic. Sweet spot: 0.8–1.3. Danger: >1.5 or <0.5.',
    sourceData: 'Whoop daily strain from `whoop_cycles` (last 28 days).',
    caveats: 'EWMA is more responsive than simple rolling mean. Below 0.5 suggests detraining; above 1.5 is associated with elevated injury risk in field-sport literature.',
    reference: 'Gabbett TJ. Br J Sports Med 50:273–280 (2016). The training—injury prevention paradox.',
  },
  {
    id: 'sri',
    metric: 'Sleep Regularity Index',
    cite: 'Phillips 2017',
    formula: 'percentage probability of being in the same sleep/wake state at the same clock minute on any two days within the window. 100 = perfectly regular, 0 = random.',
    sourceData: 'Whoop sleep start/end events from `whoop_sleep` (last 14 days, naps excluded).',
    caveats: 'Needs ≥7 nights to be meaningful, ≥14 to be stable. SRI predicts mortality and metabolic health independently of duration (Windred et al. 2024 Sleep).',
    reference: 'Phillips AJK et al., Scientific Reports 7:3216 (2017). https://doi.org/10.1038/s41598-017-03171-4',
  },
  {
    id: 'circadian-alignment',
    metric: 'Circadian Alignment',
    cite: 'Wittmann 2006',
    formula: 'sleep midpoint = (sleep_onset + sleep_offset) / 2, in local minutes-since-midnight. Drift = mean(midpoint, last 7 nights) − mean(midpoint, prior 21 nights). Reported in hours.',
    sourceData: 'Whoop sleep start/end events from `whoop_sleep` (last 28 days, naps excluded).',
    caveats: 'Drift > +/− 1 hour vs personal baseline indicates social jetlag — flag for review. The sign matters: positive drift = phase-delayed (sleeping later).',
    reference: 'Wittmann M et al., Chronobiol Int 23:497–509 (2006). Social jetlag: misalignment of biological and social time.',
  },
  {
    id: 'monotony',
    metric: 'Training Monotony & Strain',
    cite: 'Foster 1998',
    formula: 'monotony = mean(daily_load_7d) / SD(daily_load_7d). strain = sum(daily_load_7d) × monotony. Verdict: monotony >2.0 = high; strain >6000 = elevated overtraining risk.',
    sourceData: 'Whoop daily strain from `whoop_cycles` (last 7 days). Day-zero counts as 0 load.',
    caveats: 'Foster\'s thresholds were derived in collegiate athletes — interpret bands as personal trend signals rather than absolute cutoffs. Empty rest days are healthy and lower monotony.',
    reference: 'Foster C, Med Sci Sports Exerc 30:1164–1168 (1998). Monitoring training in athletes with reference to overtraining syndrome.',
  },
  {
    id: 'vo2max',
    metric: 'VO₂max & Cardio Percentile',
    cite: 'ACSM normative',
    formula: 'current = latest VO₂max value. trend = slope of linear regression over last 90 days. percentile = lookup in ACSM age × sex normative table.',
    sourceData: 'Apple Health `vo2_max` series from `apple_health_metrics`. Age derived from configured DOB; sex from configured profile.',
    caveats: 'Apple\'s VO₂max estimate is conservative and based on submaximal walking/running data. Use the trend, not the absolute value, for personal tracking.',
    reference: 'ACSM\'s Guidelines for Exercise Testing and Prescription, 11th ed. (2021). Tables 4.7–4.10.',
  },
  {
    id: 'polarised',
    metric: 'Polarised Training Distribution',
    cite: 'Seiler 2010',
    formula: 'aggregate Whoop workout zone durations (zone_zero..zone_five) over last 7 days. Z1+Z2 = easy. Z3 = moderate (the "junk middle"). Z4+Z5 = hard. 80/20 verdict triggers if easy ≥80% AND hard ≥10%.',
    sourceData: 'Whoop workout zone durations (ms) from `whoop_workouts` (last 7 days).',
    caveats: 'Whoop\'s zones are heart-rate-based and use the user\'s configured max HR. Mis-calibrated max HR shifts everything. Polarised training is most-evidenced for endurance sports; less applicable for strength training.',
    reference: 'Seiler S, Int J Sports Physiol Perform 5:276–291 (2010). What is best practice for training intensity and duration distribution in endurance athletes?',
  },
  {
    id: 'recovery-debt',
    metric: 'Recovery Debt',
    cite: 'Van Dongen 2003',
    formula: 'sleep_debt_minutes = sum_{14d}(sleep_need − sleep_actual), floored at 0. strain_recovery_balance = mean(strain_7d) − mean(recovery_score_7d). Debt > 240 min OR balance > 8 = overdrawn.',
    sourceData: 'Whoop sleep need/actual from `whoop_sleep`; strain from `whoop_cycles`; recovery from `whoop_recovery` (last 14 days).',
    caveats: 'Sleep debt is reset by genuine recovery sleep, not by single long nights. The strain/recovery balance is a heuristic — use alongside subjective state.',
    reference: 'Van Dongen HPA et al., Sleep 26:117–126 (2003). The cumulative cost of additional wakefulness.',
  },
];

export function getMethodologyEntry(id: string): MethodologyEntry | undefined {
  return METHODOLOGY.find((m) => m.id === id);
}
