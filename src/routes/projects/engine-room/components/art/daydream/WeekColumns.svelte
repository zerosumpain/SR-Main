<script lang="ts">
  // WeekColumns — my verdicts, week by week, as stacked columns: useful at the base in the
  // part's colour, not useful above it, and the notes still waiting on me hatched at the top.
  // Pick a verdict to bring its layer forward. Each layer is also told apart by position and
  // pattern, so the chart doesn't lean on colour alone.
  import { shown } from '../../../lib/motion';

  interface Week { start: string; useful: number; notUseful: number; undecided: number }
  type Key = 'useful' | 'notUseful' | 'undecided';
  let { weeks }: { weeks: Week[] } = $props();

  const KEYS: Array<{ k: Key; label: string }> = [
    { k: 'useful', label: 'Useful' }, { k: 'notUseful', label: 'Not useful' }, { k: 'undecided', label: 'No verdict yet' },
  ];
  let focus = $state<Key | null>(null);
  const top = $derived(Math.max(1, ...weeks.map((w) => w.useful + w.notUseful + w.undecided)));
  const week = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const total = (k: Key) => weeks.reduce((n, w) => n + w[k], 0);
</script>

<div class="wc" data-focus={focus ?? ''}>
  <div class="keys" role="group" aria-label="Bring a verdict forward">
    {#each KEYS as x (x.k)}
      <button class="key" data-k={x.k} class:on={focus === x.k} aria-pressed={focus === x.k} onclick={() => (focus = focus === x.k ? null : x.k)}>
        <span class="sw" aria-hidden="true"></span>{x.label}<b>{total(x.k)}</b>
      </button>
    {/each}
  </div>
  <div class="cols" style="--n:{weeks.length}" {@attach shown({ amount: 0.3 })}
    role="img" aria-label={weeks.map((w) => `Week of ${week(w.start)}: ${w.useful} useful, ${w.notUseful} not useful, ${w.undecided} undecided`).join('; ')}>
    {#each weeks as w, i (w.start)}
      {@const sum = w.useful + w.notUseful + w.undecided}
      <div class="col" style="--d:{i * 0.08}s">
        <span class="sum">{sum}</span>
        <div class="stack" style="height:{(sum / top) * 100}%">
          <span class="seg undecided" style="flex:{w.undecided}"></span>
          <span class="seg notUseful" style="flex:{w.notUseful}"></span>
          <span class="seg useful" style="flex:{w.useful}"></span>
        </div>
        <span class="wk">{week(w.start)}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .keys { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 22px; }
  .key { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: var(--radius-pill); border: 1px solid var(--rule-strong);
    background: transparent; color: var(--fg-2); font-size: var(--fs-label); cursor: pointer; transition: border-color 0.2s, color 0.2s; }
  .key b { font-family: var(--er-mono); font-weight: 500; color: var(--fg); }
  .key.on { border-color: var(--fg); color: var(--fg); }
  .sw { width: 14px; height: 14px; border-radius: var(--radius-sharp); }
  [data-k='useful'] .sw, .seg.useful { background: var(--tone); }
  [data-k='notUseful'] .sw, .seg.notUseful { background: var(--fg-3); }
  [data-k='undecided'] .sw, .seg.undecided { background: repeating-linear-gradient(135deg, var(--fg-3) 0 2px, transparent 2px 6px); outline: 1px solid var(--rule-strong); outline-offset: -1px; }

  .cols { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 150px)); justify-content: space-around; gap: clamp(6px, 1.4vw, 18px); height: 300px; align-items: end; border-bottom: 2px solid var(--fg); }
  .col { height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; position: relative; }
  .stack { display: flex; flex-direction: column; min-height: 2px; transform-origin: bottom; transition: transform 1s var(--er-ease) var(--d); }
  .cols:global([data-armed]:not([data-shown])) .stack { transform: scaleY(0); }
  .seg { display: block; transition: opacity 0.3s; }
  .sum { text-align: center; font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); margin-bottom: 6px; }
  .wk { position: absolute; bottom: -26px; left: 0; right: 0; text-align: center; font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); white-space: nowrap; }
  .cols { margin-bottom: 32px; }
  [data-focus='useful'] .seg:not(.useful), [data-focus='notUseful'] .seg:not(.notUseful), [data-focus='undecided'] .seg:not(.undecided) { opacity: 0.18; }
  @media (max-width: 560px) { .wk { transform: rotate(-45deg); transform-origin: top center; bottom: -34px; } .cols { margin-bottom: 44px; } }
</style>
