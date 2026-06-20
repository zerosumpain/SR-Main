<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { PRESSURES_BY_ID } from '../lib/pressures';
  const focus = $derived(app.align.focus);
</script>

<ol class="rf">
  {#each focus as f (f.kind + f.id)}
    <li class="rf-item">
      <span class="rf-kind" class:mat={f.kind === 'maturity'}>{f.kind === 'maturity' ? 'Maturity' : 'Pressure'}</span>
      <div class="rf-body">
        <span class="rf-title">{f.title}</span>
        <span class="rf-reason">{f.reason}</span>
      </div>
      {#if f.kind === 'pressure' && PRESSURES_BY_ID[f.id]?.demands?.length}
        <button class="rf-act" onclick={() => app.focusArea(PRESSURES_BY_ID[f.id].demands[0])} title="Jump to the first capability this needs">↪ Invest</button>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .rf { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .rf-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); background: rgba(255,255,255,0.4); }
  .rf-kind { font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em; color: #8a2d3a; background: rgba(138,45,58,0.1); padding: 3px 6px; border-radius: var(--radius-round); white-space: nowrap; }
  .rf-kind.mat { color: var(--accent-ink); background: var(--accent-ink-tint-12); }
  .rf-body { display: flex; flex-direction: column; min-width: 0; }
  .rf-title { font-size: 12.5px; font-weight: 600; color: var(--ink); }
  .rf-reason { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.55); }
  .rf-act { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 9px; padding: 4px 8px; border: 1px solid var(--accent-ink-tint-35); color: var(--accent-ink); background: var(--accent-ink-tint-06); border-radius: var(--radius-round); cursor: pointer; white-space: nowrap; }
  .rf-act:hover { background: var(--accent-ink-tint-22); }
</style>
