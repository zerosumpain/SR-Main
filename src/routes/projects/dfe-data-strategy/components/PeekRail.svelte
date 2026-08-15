<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { pct } from '../lib/format';
  const cov = $derived(app.align.overallCoverage);
  const tensions = $derived(app.align.tensions.length);
</script>

<button class="pr" onclick={() => app.openDrawer()} title="Open the levers">
  <span class="pr-lab">Levers</span>
  <div class="pr-cov">
    <span class="pr-cov-v">{pct(cov)}</span>
    <span class="pr-cov-l">covered</span>
  </div>
  <div class="pr-ring">
    <svg viewBox="0 0 40 40" width="40" height="40">
      <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(28,22,17,0.12)" stroke-width="4" />
      <circle cx="20" cy="20" r="16" fill="none" stroke="#2f7d4f" stroke-width="4" stroke-linecap="round"
        stroke-dasharray={`${cov * 100.5} 100.5`} transform="rotate(-90 20 20)" />
    </svg>
  </div>
  {#if tensions > 0}
    <span class="pr-tense">⚠ {tensions} tension{tensions === 1 ? '' : 's'}</span>
  {:else}
    <span class="pr-ok">no tensions</span>
  {/if}
  <span class="pr-open">☰ Open</span>
</button>

<style>
  .pr { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 14px 8px; background: var(--accent-ink-tint-06); border: none; border-right: 1px solid var(--accent-ink-tint-22); cursor: pointer; }
  .pr:hover { background: var(--accent-ink-tint-12); }
  .pr-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent-ink); }
  .pr-cov { display: flex; flex-direction: column; align-items: center; }
  .pr-cov-v { font-family: var(--fs-serif); font-weight: 600; font-size: 20px; color: var(--ink); }
  .pr-cov-l { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .pr-ring { line-height: 0; }
  .pr-tense { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--error); text-align: center; line-height: 1.3; }
  .pr-ok { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--success); }
  .pr-open { margin-top: auto; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); }
</style>
