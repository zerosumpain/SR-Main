<script lang="ts">
  // UnitTrap — the same integer, read two ways.
  //
  // The instrument is a magnifier on one column. Every measurement is stored as hundredths so
  // nothing is a float and nothing rounds on the way in, which is a good decision that puts
  // the unit somewhere the type system cannot see it. Picking "daily strain" is the payoff:
  // that one is ambiguous in the table itself, and the reader has to guess exactly the way the
  // code does.
  import { READINGS, SCALE } from '../../../lib/feeds';

  let sel = $state(READINGS[0].id);
  const r = $derived(READINGS.find((x) => x.id === sel) ?? READINGS[0]);
  const ambiguous = $derived(r.id === 'strain');
</script>

<div class="ut">
  <div class="chips" role="group" aria-label="Measurements">
    {#each READINGS as x (x.id)}
      <button type="button" class:on={sel === x.id} aria-pressed={sel === x.id}
              onclick={() => (sel = x.id)}>{x.label}</button>
    {/each}
  </div>

  <div class="cols">
    <div class="col">
      <span class="c-k">What is in the column</span>
      <b class="c-v raw">{r.stored.toLocaleString('en-GB')}</b>
      <span class="c-n">an integer, no unit attached</span>
    </div>
    <span class="op" aria-hidden="true">÷{SCALE}</span>
    <div class="col">
      <span class="c-k">What it means</span>
      <b class="c-v ok">{r.real}</b>
      <span class="c-n">{r.unit}</span>
    </div>
    <div class="col bad">
      <span class="c-k">If you forget</span>
      <b class="c-v no">{r.wrong}</b>
      <span class="c-n">and nothing anywhere complains</span>
    </div>
  </div>

  <p class="say" aria-live="polite">
    {#if ambiguous}
      <b>This one is ambiguous in the table itself.</b> A legacy path once wrote strain scaled like everything
      else, so both forms are stored. The reader therefore guesses: above 22 — off the top of a scale that
      stops at 21 — divide. It is correct, it is documented, and it is a unit conversion decided by a
      threshold.
    {:else}
      Stored as hundredths so nothing is a float and nothing rounds on the way in. The cost is that the
      unit lives in a convention, and a convention is not enforced anywhere.
    {/if}
  </p>
</div>

<style>
  .ut { display: flex; flex-direction: column; gap: 11px; min-width: 0; }

  .chips { display: flex; gap: 5px; flex-wrap: wrap; }
  .chips button { font-family: var(--font-body); font-size: var(--fs-label-xs); color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-sharp); padding: 5px 11px; cursor: pointer; }
  .chips button:hover { background: rgba(28,22,17,0.07); }
  .chips button.on { background: var(--success); border-color: var(--success); color: #fff; }

  .cols { display: grid; grid-template-columns: 1fr auto 1fr 1fr; gap: 8px 12px; align-items: center; }
  .col { display: flex; flex-direction: column; gap: 2px; padding: 10px 13px;
    border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.55); min-width: 0; }
  .col.bad { border-color: rgba(138,45,58,0.3); background: rgba(138,45,58,0.05); }
  .c-k { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.45); }
  .c-v { font-family: var(--font-mono); font-size: 19px; font-weight: 600;
    line-height: 1.1; letter-spacing: -0.02em; overflow-wrap: anywhere; }
  .c-v.raw { color: rgba(28,22,17,0.55); }
  .c-v.ok { color: var(--success); }
  .c-v.no { color: #8a2d3a; font-size: var(--fs-body-sm); }
  .c-n { font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.5); }
  .op { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.4); }

  .say { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 88ch; }
  .say b { color: var(--text-primary); }

  @media (max-width: 720px) {
    .cols { grid-template-columns: 1fr; }
    .op { display: none; }
  }
</style>
