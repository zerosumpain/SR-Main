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
    formula: 'weighted mean of recovery (40%), HRV trend (20%), sleep quality (20%), load balance (20%) — clipped to 0–100',
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
  {
    id: 'trimp',
    metric: 'TRIMP — Training Impulse',
    cite: 'Banister 1991',
    formula: 'per workout: Σ over HR samples of dt_min × HRr × 0.64 × e^(1.92·HRr), where HRr = (HR − rest) / (max − rest). Sample gaps are charged for at most 5 minutes. Workouts without an HR series fall back to the same formula over average HR, which understates interval work.',
    sourceData: 'Trails workout heart-rate series from `activity_series` (Apple Watch via Health Auto Export). HRrest = 28-day mean Whoop resting HR; HRmax = highest observed workout HR, floored at Tanaka 208 − 0.7 × age.',
    caveats: 'TRIMP is one number for a whole session — it cannot tell 2×20 min threshold from a steady run of equal load. Loads are only comparable against your own history, not other people\'s.',
    reference: 'Banister EW, in MacDougall et al. (eds), Physiological Testing of the High-Performance Athlete (1991). EWMA ratio per Williams et al., Br J Sports Med 51:209–210 (2017).',
  },
  {
    id: 'hrr60',
    metric: 'HRR60 — 1-minute Heart-Rate Recovery',
    cite: 'Cole 1999',
    formula: 'HR at cooldown start minus HR 60 seconds later, interpolated from the post-workout recovery curve the watch records. Curves shorter than 60 s are discarded rather than read as a small drop.',
    sourceData: 'Apple workout `heartRateRecovery` curves kept verbatim in `activities.metadata`.',
    caveats: 'Cole\'s ≤12 bpm abnormal threshold came from a treadmill protocol with an active cooldown in adults referred for testing — treat it as a floor, not a target. The drop varies with how abruptly you actually stop; compare like with like.',
    reference: 'Cole CR et al., N Engl J Med 341:1351–1357 (1999). Heart-rate recovery immediately after exercise as a predictor of mortality.',
  },
  {
    id: 'efficiency-factor',
    metric: 'Efficiency Factor',
    cite: 'coaching practice',
    formula: 'EF = speed (metres/min) ÷ average HR, over the moving portion of a workout. Tracked per sport — a ride EF and a run EF are different animals.',
    sourceData: 'Trails workout distance, moving time and average HR from `activities`.',
    caveats: 'A coaching heuristic (Friel / TrainingPeaks), not a clinical measure. Heat, wind, terrain and drift all move it — read the trend across similar sessions, never a single value. Rising EF at the same perceived effort is the signal that aerobic economy is improving.',
    reference: 'Friel J, The Cyclist\'s Training Bible / TrainingPeaks EF documentation. Durability context: Maunder E et al., Sports Med 51:1619–1628 (2021).',
  },
  {
    id: 'decoupling',
    metric: 'Aerobic Decoupling',
    cite: 'coaching practice',
    formula: 'split the workout into time halves; decoupling = (EF_first − EF_second) / EF_first, in percent. Positive = the second half cost more beats per metre.',
    sourceData: 'GPS track (`activity_tracks`) for per-half distance; HR series (`activity_series`) for per-half average HR.',
    caveats: 'Only meaningful on steady efforts over ~40 minutes — intervals, café stops and big descents all fake drift. Under ~5% on a steady session is the conventional "aerobically durable" band.',
    reference: 'Friel J / TrainingPeaks Pw:HR documentation. Physiological basis: Maunder E et al., Sports Med 51:1619–1628 (2021), durability of the moderate-intensity domain.',
  },
  {
    id: 'hr-zones',
    metric: 'Heart-Rate Zones',
    cite: 'ACSM bands',
    formula: 'five zones at 50/60/70/80/90% of HRmax; time-in-zone integrates the workout HR series, charging each sample until the next (gaps capped at 5 min). Below 50% counts as Z0 so the bar always sums to the sampled time.',
    sourceData: 'Trails workout HR series. HRmax = highest observed workout HR, floored at Tanaka 208 − 0.7 × age (age from configured DOB).',
    caveats: 'Observed-max anchoring self-corrects as harder efforts land, but until a true maximal effort exists every zone reads slightly hot. %HRmax zones ignore individual lactate thresholds — they are bands, not physiology.',
    reference: 'ACSM\'s Guidelines for Exercise Testing and Prescription, 11th ed. (2021); Tanaka H et al., J Am Coll Cardiol 37:153–156 (2001). 80/20 read: Seiler 2010.',
  },
];

export function getMethodologyEntry(id: string): MethodologyEntry | undefined {
  return METHODOLOGY.find((m) => m.id === id);
}
