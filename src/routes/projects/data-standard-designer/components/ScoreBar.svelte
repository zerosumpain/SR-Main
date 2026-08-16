<script lang="ts">
  import type { Score } from '../lib/types';
  let { score, label, sub = '', expanded = false }: { score: Score; label: string; sub?: string; expanded?: boolean } = $props();
  let open = $state(expanded);

  function color(v: number) {
    if (v >= 80) return 'var(--success)';
    if (v >= 60) return '#6a8f2d';
    if (v >= 40) return 'var(--warn)';
    return 'var(--error)';
  }
</script>

<div class="sb">
  <button class="sb-head" onclick={() => (open = !open)} aria-expanded={open}>
    <div class="sb-meta">
      <span class="sb-label">{label}</span>
      {#if sub}<span class="sb-sub">{sub}</span>{/if}
    </div>
    <div class="sb-num">
      <span class="v" style="color:{color(score.value)}">{score.value}</span>
      <span class="band" style="color:{color(score.value)}">{score.band}</span>
    </div>
  </button>
  <div class="sb-track"><div class="sb-fill" style="width:{score.value}%; background:{color(score.value)}"></div></div>
  {#if open}
    <ul class="sb-items">
      {#each score.items as it}
        <li class:met={it.met}>
          <span class="dot" class:met={it.met}>{it.met ? '✓' : '○'}</span>
          <span class="it-l">{it.label}</span>
          <span class="it-d">{it.detail}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .sb { border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); background: var(--card-bg); overflow: hidden; }
  .sb-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px 8px; background: transparent; border: none; cursor: pointer; text-align: left; }
  .sb-label { font-family: var(--font-body); font-weight: 700; font-size: var(--fs-nav); color: var(--text-primary); display: block; }
  .sb-sub { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .sb-num { display: flex; align-items: baseline; gap: 7px; }
  .sb-num .v { font-family: var(--font-display); font-size: 30px; line-height: 1; }
  .sb-num .band { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; }
  .sb-track { height: 5px; background: var(--surface-overlay); }
  .sb-fill { height: 100%; transition: width 0.2s var(--ease-out); }
  .sb-items { list-style: none; margin: 0; padding: 8px 14px 12px; display: flex; flex-direction: column; gap: 7px; }
  .sb-items li { display: grid; grid-template-columns: 16px 1fr; gap: 2px 8px; align-items: start; }
  .sb-items .dot { grid-row: 1 / span 2; font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .sb-items .dot.met { color: var(--success); }
  .it-l { font-size: var(--fs-label); font-weight: 600; color: var(--text-primary); }
  .it-d { grid-column: 2; font-size: var(--fs-label-xs); line-height: 1.4; color: var(--text-muted); }
</style>
