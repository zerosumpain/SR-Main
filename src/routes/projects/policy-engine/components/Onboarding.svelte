<script lang="ts">
  import { app } from '../lib/appState.svelte';

  const STEPS = [
    { n: '1', t: 'Set the policy', d: 'Open the <b>Levers</b> on the left and drag the sliders — or pick a ready-made <b>Scenario</b> from the bar at the top (e.g. “Attendance blitz”). The levers stay docked beside the data, so you can watch your changes land.' },
    { n: '2', t: 'Watch the outcomes', d: 'The scorecard up top and the charts on <b>Outcomes</b> update live: the disadvantage gap, attainment, the SEND funding cliff, absence and youth unemployment — your package versus doing nothing.' },
    { n: '3', t: 'Go deeper', d: '<b>Population</b> turns the results into real children and lifetime-earnings; <b>Regions</b> breaks them down by area; <b>Method</b> shows every calculation and source.' },
  ];
  function done() {
    app.showHelp = false;
    try { localStorage.setItem('epm-onboarded', '1'); } catch { /* ignore */ }
    // leave drawerUserSet untouched so the route default applies (open on data pages, closed on the landing)
  }
</script>

{#if app.showHelp}
  <div class="ob-backdrop" role="presentation" onclick={done}>
    <div class="ob" role="dialog" aria-modal="true" aria-label="How to use Education Policy Modelling" onclick={(e) => e.stopPropagation()}>
      <span class="ob-eyebrow">Field Study №4 · How to use it</span>
      <h2 class="ob-h">A flight simulator for England’s schools</h2>
      <p class="ob-lede">
        Move the policies a government actually controls and watch what happens to the disadvantage gap — and to real children —
        every year to 2040. It’s built on the research, and honest about what nobody knows for sure.
      </p>
      <ol class="ob-steps">
        {#each STEPS as s}
          <li><span class="s-n">{s.n}</span><div><span class="s-t">{s.t}</span><span class="s-d">{@html s.d}</span></div></li>
        {/each}
      </ol>
      <p class="ob-tip">
        <b>Tip:</b> not an analyst? Flip <b>Explain</b> (top right) from <i>Research</i> to <i>ELI5</i> for plain-English everywhere,
        and hover any scorecard for what it means.
      </p>
      <div class="ob-foot">
        <button class="ob-go" onclick={done}>Start exploring →</button>
        <span class="ob-note">You can reopen this any time from <b>? How to use</b>.</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .ob-backdrop { position: fixed; inset: 0; z-index: 300; background: rgba(28,22,17,0.42); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 22px; }
  .ob { width: min(560px, 100%); max-height: 92vh; overflow-y: auto; background: var(--paper, #f1ead6); border: 1px solid rgba(28,22,17,0.2);
    border-radius: 14px; box-shadow: 0 28px 70px -20px rgba(0,0,0,0.5); padding: 22px 24px; font-family: 'DM Sans', system-ui, sans-serif; }
  .ob-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .ob-h { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(22px, 3.2vw, 28px); line-height: 1.06; letter-spacing: -0.02em; margin: 7px 0 10px; color: var(--ink, #1c1611); }
  .ob-lede { margin: 0 0 16px; font-size: 13.5px; line-height: 1.6; color: rgba(28,22,17,0.74); max-width: 60ch; }
  .ob-steps { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .ob-steps li { display: flex; gap: 12px; align-items: flex-start; }
  .s-n { flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%; background: var(--ink, #1c1611); color: var(--paper, #f1ead6);
    font-family: 'JetBrains Mono', monospace; font-size: 12px; display: inline-flex; align-items: center; justify-content: center; }
  .s-t { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink, #1c1611); margin-bottom: 1px; }
  .s-d { display: block; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.7); }
  .s-d :global(b) { color: var(--ink, #1c1611); }
  .ob-tip { margin: 0 0 18px; padding: 9px 12px; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.7); background: rgba(63,125,110,0.08); border: 1px solid rgba(63,125,110,0.25); border-radius: 8px; }
  .ob-tip b { color: var(--ink, #1c1611); }
  .ob-foot { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .ob-go { font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 10px 18px; border-radius: 9px; border: none; background: var(--ink, #1c1611); color: var(--paper, #f1ead6); cursor: pointer; }
  .ob-go:hover { background: #000; }
  .ob-note { font-size: 11px; color: rgba(28,22,17,0.55); } .ob-note b { color: rgba(28,22,17,0.75); }
</style>
