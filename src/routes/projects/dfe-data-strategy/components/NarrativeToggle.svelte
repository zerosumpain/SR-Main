<script lang="ts">
  import { app } from '../lib/appState.svelte';
</script>

<div class="nt" role="group" aria-label="Explanation detail">
  <span class="nt-lab" title="Switch how every explanation on the site is written">Explain</span>
  <div class="seg">
    <button class:on={app.narrative === 'research'} onclick={() => (app.narrative = 'research')}
            title="Research view — the full explanation, with the evidence, as an analyst would read it.">Research</button>
    <button class:on={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')}
            title="ELI5 — the same thing in plain, jargon-free English.">ELI5</button>
  </div>
</div>

<style>
  .nt { display: inline-flex; align-items: center; gap: 6px; }
  .nt-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-round); }
  .seg button { background: transparent; border: none; color: var(--ink); padding: 4px 9px; border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 10px; cursor: pointer; }
  .seg button.on { background: var(--ink); color: var(--paper); }
</style>
