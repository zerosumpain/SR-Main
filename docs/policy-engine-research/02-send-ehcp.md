# Calibration log — SEND & EHCP reform (England)

## Policy timeline
- 2022 SEND Green Paper "Right support, Right place, Right time" → 2023 SEND & AP Improvement Plan (mostly
  unimplemented before 2024 election).
- **2026 Schools White Paper "Every Child Achieving and Thriving"** (23 Feb 2026): tiered support
  (universal/targeted/targeted-plus/specialist); statutory **Individual Support Plans (ISPs)** (statutory
  Sept 2029); **Inclusive Mainstream Fund** (>£500m/yr, £400m to schools); **Experts at Hand** (£1.8bn/3yr
  specialists into mainstream); inclusion bases; EHCP reform. No EHCP support changes before Sept 2030;
  reassessments from Sept 2029.
- **DSG statutory override now due to end March 2028** (was 2026) — IFS Green Budget Oct 2025. Cliff-edge.

## Sourced baselines (Jan 2025 unless noted)
- **EHCP stock 638,700**, +10.8%/yr; **prevalence 5.2–5.3%** of pupils (was 2.7% in 2016). New plans/yr 97,700
  (+15.8%). Assessment requests 154,500/yr, 65.4% approved.
- **SEN Support 14.2%** of pupils; total SEN ~1.7m = 19.6%.
- Primary need: autism 31.5% of EHCPs (54k→149k 2015–25); SEMH 20.7%.
- **20-week compliance 46.4%** (2024, record low). **Tribunal ~25,000 appeals/yr, ~99% parent win** (counts
  partial wins — overstated; ~31% get placement preference).
- Placement of EHCP holders: mainstream 43.6% / special 30.4% / FE 13.8% / AP 0.8%.
- **Cost/place: independent special ~£61.5k vs state special ~£24k** (+£10k place funding); mainstream funds
  first £6,000/SEN pupil. SEND transport ~£8,900/child/yr (vs £3,100 mainstream); SEND transport ~£2bn/yr.
- **High-needs spend ~£12bn (2025-26)**, +66% real since 2016 (~6%/yr). **Deficit stock >£3bn (Mar 2025) →
  forecast >£8bn (Mar 2028)** without reform. Annual gap ~£0.9bn (2025-26) → ~£2.4bn (2027-28).
- County Councils Network: 18 councils insolvent overnight / 24 by 2027 if override ends with deficits on-book.
- 2026 reform envelope: IMF £1.2bn/3yr + Experts at Hand £1.8bn/3yr (~£3.4bn); £3.7bn for ~60,000 specialist
  places; +£7bn SEND support 2028-29 vs 2025-26 (stated).

## Outcomes
- **Attainment 8: EHCP ~14.2 vs ~50 non-SEN**; EHCP ~39.6 months behind at GCSE, SEN Support ~21.8 behind.
- Grade5+ Eng&Maths gap EHCP vs SEN-Support 14.9pp. Y11 persistent absence ~47% (EHCP), ~43% (SEN Support).
- SEND = 47% of permanent exclusions. NEET among EHCP cohort 2.8% (18,100).

## Modelling guidance (effect sizes ≈ ASSUMPTIONS — sweep as tuning params)
- **Government EHCP trajectory (policy scenario, not validated): 5.3% now → 7.7% peak (2029-30) → 4.7%
  (2034-35)**; ~1 in 8 EHCP holders → ISPs 2030–35. IFS implicitly disputes that mainstream investment alone
  reverses growth.
- **No-reform EHCP growth band ~+8 to +11%/yr.**
- **Elasticity of EHCP new-issue growth to inclusive-mainstream funding: NO published estimate.** Tuning band
  0% to −30%, central −10 to −15%, 2–3yr lag. Prior "ordinarily available" funding did not bend the curve.
- **EHCP-reform double-edge:** narrowing plans cuts deficit but, without matching mainstream investment,
  worsens SEND attainment + raises tribunal/appeal volume. Model both signs.
- Independent→state substitution saves ~£25–35k/pupil/yr (constrained by 60k places pipeline).
- 20-week compliance = capacity-constrained queue f(EP-FTE / requests); Experts at Hand adds EP capacity.

## Key sources
EES EHC plans 2025 https://explore-education-statistics.service.gov.uk/find-statistics/education-health-and-care-plans/2025 ·
EES SEN 2024/25 · IFS Green Budget 2025 ch.5 (SEND) ·
IFS "Spending on SEN" Dec 2024 · NAO SEN Oct 2024 · NAO home-to-school transport Oct 2025 ·
Schools White Paper EHCP detail https://schoolsweek.co.uk/schools-white-paper-what-is-happening-to-ehcps-under-send-reforms/ ·
Inclusive Mainstream Fund methodology gov.uk · EPI 2025 SEND · County Councils Network insolvency.
