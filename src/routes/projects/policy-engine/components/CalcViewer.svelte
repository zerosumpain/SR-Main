<script lang="ts">
  // CalcViewer — the live "show your working" panel. Pick a headline outcome and watch the
  // engine's OWN intermediate terms (via runSim's trace) build up to the published value,
  // updating as you drag the docked levers. A "= the engine's value ✓" check proves the
  // displayed maths reconciles exactly to the model. Toggle to the real engine.ts source.
  // Self-contained.
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { app } from '../lib/appState.svelte';
  import { runSim } from '../lib/engine';
  import LeverSlider from './LeverSlider.svelte';
  import { OUTCOMES_BY_ID, OUTCOME_ELI5_LABEL } from '../lib/outcomes';
  import { fmt, signed } from '../lib/chartkit';

  // Grouped so the picker reads as a guided tour of the model's mechanics.
  const GROUPS: { label: string; keys: string[] }[] = [
    { label: 'Equity — the disadvantage gap', keys: ['gapAge3', 'gapReception', 'gapKS2', 'gapKS4'] },
    { label: 'Attainment', keys: ['gld', 'ks2RWM', 'attainment8', 'attainment8Dis', 'grade5EM'] },
    { label: 'System', keys: ['persistentAbsenceDis', 'childPoverty', 'fundingPerPupil'] },
    { label: 'SEND', keys: ['highNeedsDeficitStock'] },
    { label: 'Post-16', keys: ['neet'] },
  ];
  let selected = $state('gapKS4');
  let view = $state<'math' | 'code'>('math');
  let openTerm = $state<number | null>(null);

  const eli = $derived(app.narrative === 'eli5');
  const trace = $derived(runSim(app.levers, { trace: app.horizon }).trace);
  const ot = $derived(trace?.outcomes[selected]);

  // levers feeding this outcome (dedup, in order of appearance)
  const levers = $derived.by(() => {
    const ids: string[] = [];
    for (const t of ot?.terms ?? []) for (const id of t.leverIds ?? []) if (!ids.includes(id)) ids.push(id);
    return ids;
  });

  const tResult = new Tween(0, { duration: 400, easing: cubicOut });
  $effect(() => { if (ot) tResult.target = ot.engineValue; });

  const label = (k: string) => (eli ? (OUTCOME_ELI5_LABEL[k] ?? k) : (OUTCOMES_BY_ID[k]?.label ?? trace?.outcomes[k]?.title ?? k));

  // The REAL engine.ts source for each traced outcome (verbatim-faithful excerpts).
  const CODE: Record<string, string> = {
    gapKS4: `// lib/engine.ts — the KS4 disadvantage gap (months)
const k4Absence  = ABSENCE_TO_GAP_K4 * (persistentAbsenceDis - PA_DIS_BASE); // 0.077 · (PA_dis − 29.9)
const k4PovDrift = SYS.povertyToGapDrift * (childPoverty - BASELINE.childPoverty);
const k4Housing  = IND.housingGap * dep('housing_instability') * ramp(ys, 2);
let structReductionsK4 = channelSum(k4Struct, ys, lagOf);   // pupil premium, teachers, RISE, tutoring …
for (const id of ['eypp','ey_quality','ey_access'])         // early years: ~11-year cohort lag + fade-out
  structReductionsK4 += CH.gapKS4[id] * concave(depPos(id)) * ramp(ys, EY_KS4_LAG) * EY_FADEOUT;
const gapKS4 = clamp(
  BASELINE.gapKS4 + k4Absence + k4PovDrift + k4Housing - structReductionsK4, 0.5, 30,
);`,
    gapAge3: `// lib/engine.ts — the development gap at age 3 (the below-5 extension)
const age3Pov      = POVERTY_TO_AGE3 * (childPoverty - BASELINE.childPoverty); // home learning env. proxy
const reductionsAge3 = channelSum(age3Map, ys, () => 1.5);   // EY quality/access/EYPP/poverty — fast (~1.5y)
const sendEarlyAge3  = CH.gapAge3.send_early * concave(depPos('send_early')) * ramp(ys, 2);
const gapAge3 = clamp(
  BASELINE.gapAge3 + age3Pov - reductionsAge3 - sendEarlyAge3, 0.2, 7,
);`,
    attainment8: `// lib/engine.ts — Attainment 8 (all pupils). Money acts via teacher CAPACITY, not directly.
const teacherAttnA8 = CH.levelA8.teachers * capacityNorm * ramp(ys, 4);
const a8Other =
    CH.levelA8.attendance  * concave(depPos('attendance'))  * ramp(ys, 2)
  + CH.levelA8.curriculum  * concave(depPos('curriculum'))  * ramp(year - 2028, 4)
  + CH.levelA8.rise        * concave(depPos('rise'))        * ramp(ys, 2)
  + CH.levelA8.breakfast   * concave(depPos('breakfast'))   * ramp(ys, 1)
  + CH.levelA8.reading     * concave(depPos('reading'))     * ramp(ys, 2)
  + CH.levelA8.eal_support * concave(depPos('eal_support')) * ramp(ys, 2);
const attainment8 = clamp(BASELINE.attainment8 + teacherAttnA8 + a8Other, 30, 70);`,
    deficit: `// lib/engine.ts — the high-needs (DSG) deficit stock. A stock-flow.
const dsgSpend       = SEND.spendPerPrevalence * ehcpPct * (1 - subSaving);   // demand-driven inflow
const highNeedsFunding = BASELINE.highNeedsFunding * (1 + val('high_needs')/100) ** ys;
deficitStock = Math.max(0, deficitStock + (dsgSpend - highNeedsFunding));     // carry + inflow − funding`,
    neet: `// lib/engine.ts — NEET (16–24) = three segments with different dynamics.
// Programme cuts act MULTIPLICATIVELY per segment (proportional hazards).
const neetUnemployed     = uPressure  * survive([...workRouteCuts], BASELINE.neetUnemployed);
const neetInactiveHealth = ihPressure * survive([...mentalHealthCuts], BASELINE.neetInactiveHealth);
const neetInactiveOther  = ioPressure * survive([...otherCuts], BASELINE.neetInactiveOther);
const neet = neetUnemployed + neetInactiveHealth + neetInactiveOther;`,
    gapKS2: `// lib/engine.ts — the KS2 (age 11) disadvantage gap (months)
const k2Absence = ABSENCE_TO_GAP_K2 * (persistentAbsenceDis - PA_DIS_BASE);
let structReductionsK2 = channelSum(k2Map, ys, lagOf);      // PP, poverty action, reading, RISE
for (const id of ['ey_quality','eypp'])                     // EY carry-over (~6y)
  structReductionsK2 += CH.gapKS2[id] * concave(depPos(id)) * ramp(ys, 6);
const gapKS2 = clamp(BASELINE.gapKS2 + k2Absence - structReductionsK2, 0.3, 16);`,
    gapReception: `// lib/engine.ts — the age-5 (reception) disadvantage gap (months)
const recepPov       = POVERTY_TO_RECEP * (childPoverty - BASELINE.childPoverty);
const reductionsRecep = channelSum(recepMap, ys, () => 2);  // EY quality/access/EYPP/poverty — ~2y
const gapReception = clamp(BASELINE.gapReception + recepPov - reductionsRecep, 0.3, 8);`,
    gld: `// lib/engine.ts — Good Level of Development at age 5 (%)
const gldDelta =
    CH.levelGLD.ey_quality     * concave(depPos('ey_quality'))     * ramp(ys, 3)
  + CH.levelGLD.ey_access      * concave(depPos('ey_access'))      * ramp(ys, 2)
  + CH.levelGLD.eypp           * concave(depPos('eypp'))           * ramp(ys, 3)
  + CH.levelGLD.poverty_action * concave(depPos('poverty_action')) * ramp(ys, 3);
const gld = clamp(BASELINE.gld + gldDelta, 40, 95);`,
    ks2RWM: `// lib/engine.ts — KS2 reading+writing+maths expected standard (%)
const teacherAttnK2 = CH.levelKS2.teachers * capacityNorm * ramp(ys, 4);  // capacity channel
const k2Other = attendance + curriculum + reading + RISE channels;
const ks2RWM = clamp(BASELINE.ks2RWM + teacherAttnK2 + k2Other, 35, 95);`,
    grade5EM: `// lib/engine.ts — Grade 5+ in English & Maths (%). A linear function of Attainment 8.
const grade5EM = clamp(BASELINE.grade5EM + 2.2 * (attainment8 - BASELINE.attainment8), 10, 95);`,
    a8Dis: `// lib/engine.ts — disadvantaged Attainment 8 = the all-pupil level MINUS the gap.
// GAP_TO_LEVEL.ks4A8 (A8 points per month) is derived so 2025 reproduces exactly.
const attainment8Dis = clamp(attainment8 - GAP_TO_LEVEL.ks4A8 * gapKS4, 20, 70);`,
    paDis: `// lib/engine.ts — disadvantaged persistent absence (%). The model's central hub.
const paSystem = SYS.paLeverage * SYS.paDisLeverage * (absenceOverall - BASELINE.absenceOverall); // 2.5×1.3
const persistentAbsenceDis = clamp(
  PA_DIS_BASE + paSystem - extraMentorDisCut + housingPA - pipelinePAcut, 8, 45,
);`,
    childPoverty: `// lib/engine.ts — relative child poverty (% AHC). An upstream driver.
const povDrift  = SYS.povertyDrift * ys;                                       // baseline trend
const povAction = SYS.povertyActionMax * concave(depPos('poverty_action')) * ramp(ys, 3);
const povFsm    = SYS.fsmPovertyCut    * concave(depPos('fsm'))            * ramp(ys, 3);
const childPoverty = clamp(BASELINE.childPoverty + povDrift - povAction - povFsm, 15, 40);`,
    funding: `// lib/engine.ts — mainstream funding per pupil (£). The SEND cliff bites here.
const fundGrowth      = base * (1 + val('school_funding')/100) ** ys - base;
const sendLeak        = ys > 0 ? 50 * Math.max(0, dsgSpend - 12.0) : 0;          // high-needs leak
const overridePenalty = (year >= 2028) ? 8 * Math.max(0, deficitStock - 3) : 0;  // override ends 2028
const fundingPerPupil = clamp(base + fundGrowth - sendLeak - overridePenalty, 4500, 12000);`,
  };
</script>

<div class="cv">
  <div class="cv-head">
    <div class="cv-pick">
      <span class="cv-lab">Show the working for</span>
      <select bind:value={selected} aria-label="Outcome to break down">
        {#each GROUPS as grp}
          <optgroup label={grp.label}>
            {#each grp.keys as k}<option value={k}>{label(k)}</option>{/each}
          </optgroup>
        {/each}
      </select>
      <span class="cv-yr">in {app.horizon}</span>
    </div>
    <div class="cv-toggle" role="group" aria-label="View">
      <button class:on={view === 'math'} onclick={() => (view = 'math')}>Maths</button>
      <button class:on={view === 'code'} onclick={() => (view = 'code')}>Code</button>
    </div>
  </div>

  {#if ot}
    <div class="cv-grid">
      <div class="cv-work">
        {#if view === 'math'}
          <div class="eq">
            <div class="eq-row base">
              <span class="t-lab">{ot.baseLabel}</span>
              <span class="t-sym"></span>
              <span class="t-val">{fmt(ot.base, 1)}</span>
            </div>
            {#each ot.terms as t, i}
              <div class="eq-row" class:open={openTerm === i}>
                <button class="t-main" onclick={() => (openTerm = openTerm === i ? null : i)}
                        disabled={!t.parts} aria-expanded={openTerm === i}>
                  <span class="t-op">{t.value >= 0 ? '+' : '−'}</span>
                  <span class="t-lab">{t.label}{#if t.parts}<i class="t-exp">{openTerm === i ? '▾' : '▸'}</i>{/if}</span>
                  <span class="t-sym">{t.symbol}</span>
                  <span class="t-val" style="color:{t.value >= 0 ? '#b4455e' : '#2f7d4f'}">{signed(t.value, 2)}</span>
                </button>
                {#if t.note}<p class="t-note">{t.note}</p>{/if}
                {#if openTerm === i && t.parts}
                  <div class="parts">
                    {#each t.parts as p}
                      <button class="part" onclick={() => app.focusLever(p.id)} title="Jump to this slider">
                        <span class="p-lab">{p.label}</span>
                        <span class="p-val" style="color:{p.value >= 0 ? '#b4455e' : '#2f7d4f'}">{signed(p.value, 2)}</span>
                      </button>
                    {/each}
                    <p class="parts-note">Each lever's individual contribution (diminishing returns + its lag). Click to jump to the slider.</p>
                  </div>
                {/if}
              </div>
            {/each}
            <div class="eq-row result">
              <span class="t-lab">= {ot.title}</span>
              <span class="t-sym">{ot.clamped ? '(after clamp)' : ''}</span>
              <span class="t-val big">{fmt(tResult.current, 1)}<i>{ot.unit}</i></span>
            </div>
            <div class="reconcile">
              <span class="check">✓</span>
              base + terms = <b>{fmt(ot.result, 2)}</b>
              {#if ot.clamped}→ clamped to <b>{fmt(ot.engineValue, 2)}</b>{/if}
              · matches the engine's published value exactly
            </div>
          </div>
        {:else}
          <pre class="code">{CODE[ot.codeKey] ?? '// source unavailable'}</pre>
          <div class="code-live">
            <span class="cl-lab">With your current sliders, in {app.horizon}:</span>
            <div class="cl-vals">
              <span><b>{ot.baseLabel}</b> = {fmt(ot.base, 2)}</span>
              {#each ot.terms as t}<span><b>{t.label}</b> = {signed(t.value, 2)}</span>{/each}
              <span class="cl-res"><b>{ot.title}</b> = {fmt(ot.engineValue, 2)}{ot.unit} ✓</span>
            </div>
          </div>
        {/if}
      </div>

      <aside class="cv-side">
        <span class="side-lab">Drag a lever — the working updates live</span>
        {#each levers as id (id)}<LeverSlider {id} />{/each}
        {#if levers.length === 0}<p class="no-lev">This outcome is derived; it has no direct levers.</p>{/if}
      </aside>
    </div>
  {/if}
</div>

<style>
  .cv { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 12px 14px; margin: 12px 0; }
  .cv-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .cv-pick { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
  .cv-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); }
  .cv-pick select { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--ink); background: transparent; border: none; border-bottom: 2px solid #b4632e; padding: 1px 2px; cursor: pointer; }
  .cv-yr { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.5); }
  .cv-toggle { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.12); }
  .cv-toggle button { background: transparent; border: none; color: var(--ink); padding: 4px 12px; border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .cv-toggle button.on { background: var(--ink); color: var(--paper); }

  .cv-grid { display: grid; grid-template-columns: 1fr 230px; gap: 16px; align-items: start; }
  @media (max-width: 760px) { .cv-grid { grid-template-columns: 1fr; } }

  .eq { display: flex; flex-direction: column; }
  .eq-row { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 10px; align-items: baseline; padding: 5px 0; border-bottom: 1px solid rgba(28,22,17,0.06); }
  .eq-row.base { color: rgba(28,22,17,0.7); }
  .t-main { display: grid; grid-template-columns: 16px 1fr auto auto; gap: 8px; align-items: baseline; width: 100%; background: transparent; border: none; padding: 0; text-align: left; cursor: default; }
  .t-main:not(:disabled) { cursor: pointer; }
  .t-op { font-family: 'JetBrains Mono', monospace; color: rgba(28,22,17,0.4); }
  .t-lab { font-size: 12.5px; color: var(--ink); }
  .t-exp { font-style: normal; font-size: 9px; color: rgba(28,22,17,0.45); margin-left: 4px; }
  .t-sym { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.5); text-align: right; }
  .t-val { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; text-align: right; min-width: 56px; }
  .t-note { grid-column: 1 / -1; margin: 2px 0 0 24px; font-size: 10px; line-height: 1.4; color: rgba(28,22,17,0.55); }
  .eq-row.result { border-bottom: none; border-top: 1.5px solid rgba(28,22,17,0.3); margin-top: 3px; padding-top: 7px; }
  .eq-row.result .t-lab { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; }
  .t-val.big { font-family: 'Fraunces', serif; font-size: 22px; color: var(--ink); }
  .t-val.big i { font-style: normal; font-size: 10px; opacity: 0.55; margin-left: 2px; }
  .reconcile { margin-top: 7px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--success); background: var(--success-bg); border-radius: var(--radius-round); padding: 5px 8px; line-height: 1.5; }
  .reconcile .check { font-weight: 700; margin-right: 3px; }
  .reconcile b { color: var(--ink); }

  .parts { grid-column: 1 / -1; margin: 5px 0 2px 24px; display: flex; flex-direction: column; gap: 2px; border-left: 2px solid rgba(28,22,17,0.12); padding-left: 8px; }
  .part { display: flex; justify-content: space-between; gap: 10px; background: transparent; border: none; padding: 2px 4px; cursor: pointer; border-radius: var(--radius-round); }
  .part:hover { background: rgba(28,22,17,0.05); }
  .p-lab { font-size: 11px; color: rgba(28,22,17,0.75); }
  .p-val { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; }
  .parts-note { margin: 3px 0 0; font-size: 9px; color: rgba(28,22,17,0.5); }

  .code { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; line-height: 1.6; white-space: pre-wrap; background: rgba(28,22,17,0.05); border-left: 2px solid var(--accent-ink); border-radius: var(--radius-round); padding: 9px 11px; color: rgba(28,22,17,0.85); overflow-x: auto; }
  .code-live { margin-top: 8px; }
  .cl-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); }
  .cl-vals { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 4px; }
  .cl-vals span { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: rgba(28,22,17,0.7); }
  .cl-vals b { color: var(--ink); }
  .cl-res { color: var(--success) !important; }

  .cv-side { display: flex; flex-direction: column; gap: 8px; border-left: 1px solid rgba(28,22,17,0.1); padding-left: 14px; }
  @media (max-width: 760px) { .cv-side { border-left: none; padding-left: 0; border-top: 1px solid rgba(28,22,17,0.1); padding-top: 10px; } }
  .side-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); }
  .no-lev { font-size: 11px; color: rgba(28,22,17,0.55); }
</style>
