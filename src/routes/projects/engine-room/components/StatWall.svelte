<script lang="ts">
  // StatWall — the headline figures. Each tile carries how it was counted, because a page
  // arguing for engineering rigour should not ask to be taken on trust for its own numbers.
  import { STATS } from '../lib/system';
</script>

<div class="wall">
  {#each STATS as s}
    <div class="tile" title="Counted by: {s.how}">
      <b>{s.value}</b>
      <span class="lab">{s.label}</span>
      <span class="how">{s.how}</span>
    </div>
  {/each}
</div>

<style>
  .wall { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 9px; margin: 14px 0 4px; }
  .tile { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.5);
    padding: 11px 13px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .tile b { font-family: 'JetBrains Mono', monospace; font-size: 21px; font-weight: 600; color: var(--text-primary); line-height: 1.05; }
  .lab { font-family: 'DM Sans', sans-serif; font-size: 12px; color: rgba(28,22,17,0.72); }
  .how { font-family: 'JetBrains Mono', monospace; font-size: 8px; line-height: 1.35; color: rgba(28,22,17,0.42); margin-top: 3px; }
</style>
