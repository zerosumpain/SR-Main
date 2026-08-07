<script lang="ts">
  // AlarmBench — move an entity between two nights and see what, if anything, is worth saying.
  //
  // The instrument exists to make one claim physical: a threshold that is only relative fires
  // on nothing (one link becoming two is a hundred-per-cent jump), and one that is only
  // absolute never fires on a small entity and never stops firing on a hub. You can switch
  // each bar off and watch it misbehave, which is more convincing than the sentence.
  import { THRESHOLDS as T, ALARMS } from '../../../lib/watch';

  let before = $state(8);
  let after = $state(14);
  let relative = $state(true);
  let absolute = $state(true);

  const gained = $derived(after - before);
  const ratio = $derived(before > 0 ? after / before : Infinity);

  const jump = $derived.by(() => {
    const rel = !relative || after >= before * T.jumpRatio;
    const abs = !absolute || gained >= T.jumpMin;
    return gained > 0 && rel && abs;
  });
  const collapse = $derived.by(() => {
    const rel = !relative || after <= before * T.collapseRatio;
    const abs = !absolute || -gained >= T.collapseMin;
    return gained < 0 && rel && abs;
  });

  const fired = $derived(jump || collapse);
  const bothOn = $derived(relative && absolute);

  const say = $derived.by(() => {
    if (jump) return `Gained ${gained} — half again as many and at least ${T.jumpMin} more. Worth a sentence.`;
    if (collapse) return `Lost ${-gained} — down past ${Math.round(T.collapseRatio * 100)}% and at least ${T.collapseMin} fewer. Worth a sentence.`;
    if (gained === 0) return 'Nothing moved.';
    const relFail = relative && (gained > 0 ? after < before * T.jumpRatio : after > before * T.collapseRatio);
    const absFail = absolute && Math.abs(gained) < (gained > 0 ? T.jumpMin : T.collapseMin);
    if (relFail && absFail) return 'Neither bar cleared. Quiet, correctly.';
    if (relFail) return `${Math.abs(gained)} is enough in absolute terms, but not a big enough share of ${before}. Quiet.`;
    return `A large share of ${before}, but only ${Math.abs(gained)} link${Math.abs(gained) === 1 ? '' : 's'} in absolute terms. Quiet.`;
  });

  const warning = $derived.by(() => {
    if (bothOn) return null;
    if (!relative && !absolute) return 'With neither bar, every single change is an alarm — including one link becoming two.';
    if (!relative) return 'Absolute only: a change of three is an event on an entity with four links and noise on one with two hundred.';
    return 'Relative only: one link becoming two is a hundred-per-cent jump and means nothing at all.';
  });

  const shownAlarms = ALARMS.filter((a) => a.id === 'degree_jump' || a.id === 'degree_collapse');
</script>

<div class="ab">
  <div class="dials">
    <label class="f">
      <span class="f-lab">Connections last night</span>
      <input type="range" min="1" max="40" step="1" bind:value={before} />
      <output>{before}</output>
    </label>
    <label class="f">
      <span class="f-lab">Connections tonight</span>
      <input type="range" min="0" max="40" step="1" bind:value={after} />
      <output>{after}</output>
    </label>
  </div>

  <div class="bars" role="group" aria-label="Which bars a change must clear">
    <button type="button" class:on={relative} aria-pressed={relative} onclick={() => (relative = !relative)}>
      {relative ? '✓' : '○'} Relative bar<em>×{T.jumpRatio} up · ×{T.collapseRatio} down</em>
    </button>
    <button type="button" class:on={absolute} aria-pressed={absolute} onclick={() => (absolute = !absolute)}>
      {absolute ? '✓' : '○'} Absolute bar<em>±{T.jumpMin} links</em>
    </button>
  </div>

  <div class="track" role="img"
       aria-label="{before} connections became {after}, a change of {gained}. {fired ? 'An alarm fires.' : 'No alarm.'}">
    <div class="t-row"><span class="t-lab">last night</span>
      <span class="t-bar"><i style="width:{(before / 40) * 100}%"></i></span><b>{before}</b></div>
    <div class="t-row"><span class="t-lab">tonight</span>
      <span class="t-bar"><i class:up={gained > 0} class:down={gained < 0} style="width:{(after / 40) * 100}%"></i></span><b>{after}</b></div>
  </div>

  <div class="out" class:fires={fired} aria-live="polite">
    <span class="o-kick">{fired ? (jump ? 'it gained connections' : 'it lost connections') : 'no alarm'}</span>
    <p class="o-say">{say}</p>
    {#if warning}<p class="o-warn">{warning}</p>{/if}
  </div>

  <ul class="rules">
    {#each shownAlarms as a (a.id)}
      <li><b>{a.label}</b><span class="r-what">{a.what}</span><span class="r-why">{a.why}</span></li>
    {/each}
  </ul>
</div>

<style>
  .ab { display: flex; flex-direction: column; gap: 11px; min-width: 0; }

  .dials { display: flex; gap: 10px 22px; flex-wrap: wrap; }
  .f { display: flex; align-items: center; gap: 8px; }
  .f-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); white-space: nowrap; }
  .f input { accent-color: var(--accent); width: 128px; }
  .f output { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600;
    color: var(--text-primary); min-width: 2.5ch; }

  .bars { display: flex; gap: 5px; flex-wrap: wrap; }
  .bars button { display: inline-flex; align-items: baseline; gap: 7px;
    font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; }
  .bars button em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    color: rgba(28,22,17,0.45); }
  .bars button:hover { background: rgba(28,22,17,0.07); }
  .bars button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .bars button.on em { color: rgba(255,255,255,0.7); }

  .track { display: flex; flex-direction: column; gap: 4px; }
  .t-row { display: grid; grid-template-columns: 90px 1fr 34px; gap: 10px; align-items: center; }
  .t-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.08em;
    text-transform: uppercase; color: rgba(28,22,17,0.45); text-align: right; }
  .t-bar { position: relative; height: 20px; background: rgba(28,22,17,0.06);
    border-radius: var(--radius-round); overflow: hidden; }
  .t-bar i { position: absolute; inset: 0 auto 0 0; background: rgba(28,22,17,0.24);
    transition: width 0.22s cubic-bezier(0.3,0,0.2,1); }
  .t-bar i.up { background: color-mix(in srgb, var(--accent) 55%, transparent); }
  .t-bar i.down { background: rgba(138,45,58,0.45); }
  .t-row b { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-primary); }

  .out { padding: 10px 13px; border-left: 3px solid rgba(28,22,17,0.28);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; background: rgba(28,22,17,0.045); }
  .out.fires { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .o-kick { display: block; margin-bottom: 5px; font-family: 'JetBrains Mono', monospace;
    font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .out.fires .o-kick { color: var(--accent); }
  .o-say { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.78); max-width: 86ch; }
  .o-warn { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: #8a2d3a; max-width: 86ch; }

  .rules { margin: 0; padding: 0; list-style: none; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; }
  .rules li { display: flex; flex-direction: column; gap: 2px; padding: 9px 12px;
    border: 1px solid rgba(28,22,17,0.14); border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; background: rgba(255,255,255,0.5); }
  .rules b { font-size: 12.5px; color: var(--text-primary); }
  .r-what { font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.5; color: var(--accent); }
  .r-why { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.65); }

  @media (max-width: 560px) {
    .f input { width: 100px; }
    .t-row { grid-template-columns: 70px 1fr 30px; }
  }
</style>
