<script lang="ts">
  import type { LeverState } from '../lib/types';
  import { AGE_BANDS, LEVERS_BY_ID, ageBandCostBn, ageIdTotals } from '../lib/levers';
  import { AGEID } from '../lib/params';

  interface Props {
    levers: LeverState;
    onChange: (id: string, value: number) => void;
    onReset: () => void;
  }
  let { levers, onChange, onReset }: Props = $props();

  const COL = '#7a5aa6';
  const totals = $derived(ageIdTotals(levers, AGEID.sendPrevalence));
  function valOf(id: string): number { return levers[id] ?? LEVERS_BY_ID[id].baseline; }
  function pct(id: string): number {
    const L = LEVERS_BY_ID[id];
    return ((valOf(id) - L.min) / (L.max - L.min)) * 100;
  }
  function basePct(id: string): number {
    const L = LEVERS_BY_ID[id];
    return ((L.baseline - L.min) / (L.max - L.min)) * 100;
  }
</script>

<section class="aid">
  <div class="aid-head">
    <span class="tag" style="background:{COL}">ID</span>
    <span class="title">SEND / EHCP identification by age</span>
    <button class="reset" onclick={onReset}>reset</button>
  </div>
  <p class="intro">
    A sliding scale of how intensively emerging SEND is identified &amp; supported at each age. Earlier
    identification is cheaper per child and prevents later escalation; later identification is the costliest
    route. Dial each band to cost out the extra "stretch". <span class="est">High-level estimates.</span>
  </p>

  {#each AGE_BANDS as band (band.leverId)}
    {@const cost = ageBandCostBn(band, valOf(band.leverId), AGEID.sendPrevalence)}
    <div class="band">
      <div class="band-top">
        <span class="age">{band.age}</span>
        <span class="vals"><b>{valOf(band.leverId)}%</b> · £{cost.toFixed(2)}bn/yr</span>
      </div>
      <div class="slider-wrap">
        <input class="slider" type="range" min={LEVERS_BY_ID[band.leverId].min} max={LEVERS_BY_ID[band.leverId].max}
               step={LEVERS_BY_ID[band.leverId].step} value={valOf(band.leverId)}
               style="--fill:{pct(band.leverId)}%; --col:{COL}"
               oninput={(e) => onChange(band.leverId, Number((e.currentTarget as HTMLInputElement).value))} />
        <span class="base-tick" style="left:{basePct(band.leverId)}%" title="baseline {LEVERS_BY_ID[band.leverId].baseline}%"></span>
      </div>
      <p class="note">{band.note} · ~£{band.unit.toLocaleString('en-GB')}/identified child/yr</p>
    </div>
  {/each}

  <div class="totals">
    <div class="t-row"><span>Total identification + early-support cost</span><b>£{totals.total.toFixed(2)}bn/yr</b></div>
    <div class="t-row stretch"><span>Additional "stretch" vs baseline</span>
      <b style="color:{totals.additional >= 0 ? '#b4632e' : '#2f7d4f'}">{totals.additional >= 0 ? '+' : ''}£{totals.additional.toFixed(2)}bn/yr</b>
    </div>
    <p class="t-note">The additional cost flows into the Cost tab's totals and cost-effectiveness. A front-loaded
      profile also modestly improves SEND outcomes and slows late EHCP escalation (see Method &amp; calculations).</p>
  </div>
</section>

<style>
  .aid { border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); background: var(--accent-ink-tint-06); padding: 10px 11px; margin-top: 10px; }
  .aid-head { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; }
  .tag { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: 0.1em; color: #fff; padding: 2px 5px; border-radius: var(--radius-sharp); }
  .title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13px; color: var(--ink); flex: 1; }
  .reset { background: transparent; border: none; border-bottom: 1px dashed rgba(28,22,17,0.4); font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.6); cursor: pointer; text-transform: uppercase; padding: 0; }
  .reset:hover { color: var(--ink); }
  .intro { margin: 0 0 9px; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.7); }
  .est { font-style: italic; color: rgba(28,22,17,0.5); }
  .band { margin-bottom: 9px; }
  .band-top { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
  .age { font-size: 11.5px; color: var(--ink); }
  .vals { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: rgba(28,22,17,0.6); white-space: nowrap; }
  .vals b { color: var(--ink); }
  .slider-wrap { position: relative; padding-top: 2px; }
  .slider {
    -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: var(--radius-sharp);
    background: linear-gradient(to right, var(--col) 0%, var(--col) var(--fill), rgba(28,22,17,0.14) var(--fill), rgba(28,22,17,0.14) 100%);
    outline: none; cursor: pointer; margin: 4px 0;
  }
  .slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: var(--radius-pill); background: var(--paper); border: 2px solid var(--col); cursor: pointer; }
  .slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: var(--radius-pill); background: var(--paper); border: 2px solid var(--col); cursor: pointer; }
  .base-tick { position: absolute; top: 1px; width: 2px; height: 12px; background: rgba(28,22,17,0.4); transform: translateX(-50%); pointer-events: none; border-radius: var(--radius-sharp); }
  .note { margin: 1px 0 0; font-size: 9.5px; line-height: 1.3; color: rgba(28,22,17,0.5); }
  .totals { border-top: 1px solid var(--accent-ink-tint-22); margin-top: 4px; padding-top: 7px; }
  .t-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 11.5px; color: rgba(28,22,17,0.78); margin-bottom: 2px; }
  .t-row b { font-family: 'Fraunces', serif; font-size: 14px; color: var(--ink); }
  .t-row.stretch { font-weight: 500; }
  .t-note { margin: 5px 0 0; font-size: 10px; line-height: 1.4; color: rgba(28,22,17,0.55); }
</style>
