<script lang="ts">
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import { GOVERNANCE } from '$lib/policy-incentives-lab/schemas';
  let { children } = $props();
</script>
<svelte:head><meta name="robots" content="noindex,nofollow" /><title>Policy Incentives Lab — Strange Ramblings</title></svelte:head>
<HealthShell path="/policy-incentives-lab" unifiedNav nav={[]} back={{ href: '/', label: 'Strange Ramblings' }} kicker="Private analytical workspace" footer={['Owner only', 'Public or synthetic material only']}>
  <div class="lab-content">
    <a href="/policy-incentives-lab">Policy Incentives Lab / Projects</a>
    <aside id="lab-governance" class="governance" aria-label="Governance and limitations">{GOVERNANCE}</aside>
    {@render children()}
  </div>
</HealthShell>
<aside class="persistent-governance" aria-label="Persistent analytical limitations">Exploratory scenarios, not forecasts. Public/synthetic material only; no personal or sensitive data. Policy, analytical, legal, financial and operational review required. <a href="#lab-governance">Read limitations</a></aside>
<style>
  .lab-content { max-width: 1368px; margin: auto; padding: 24px 24px 120px; }
  .persistent-governance { position: fixed; inset: auto 0 0; z-index: 100; padding: 10px 16px; background: var(--text-primary); color: var(--bg); font-size: var(--fs-label); line-height: 1.5; }
  .persistent-governance a { color: var(--accent-on-dark); text-decoration: underline; }
  :global(.lab-content .chart-artifact) { border-radius: 0; }
  :global(.lab-content .chart-container) { max-height: none; overflow-x: auto; }
  .governance { border-left: 4px solid var(--accent); padding: 12px 16px; margin: 16px 0 24px; background: var(--surface-sunken); font-size: var(--fs-body); }
  :global(.lab-content h1) { font-family: var(--font-display); font-size: clamp(1.6rem, 4vw, 2.8rem); }
  :global(.lab-content h2) { font-size: 1.3rem; margin: 20px 0 12px; }
  :global(.lab-content label) { display: block; margin: 12px 0; }
  :global(.lab-content input), :global(.lab-content textarea), :global(.lab-content select) { color: var(--text-primary); background: var(--bg); border: 1px solid var(--line-strong); padding: 8px; font-size: var(--fs-body); max-width: 100%; }
  :global(.lab-content button) { border: 1px solid var(--line-strong); padding: 8px 12px; font-size: var(--fs-body); margin: 4px 4px 4px 0; }
  :global(.lab-content button:disabled) { opacity: .5; }
  :global(.lab-content button:focus-visible), :global(.lab-content a:focus-visible) { outline: 2px solid var(--accent); outline-offset: 3px; }
  :global(.lab-content pre) { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--fs-body); }
  :global(.lab-content .error) { border-left: 4px solid var(--error); padding: 12px; white-space: pre-wrap; }
  @media (max-width: 600px) { .lab-content { padding: 12px 12px 150px; } }
</style>
