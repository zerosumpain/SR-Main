<script lang="ts">
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  let { children } = $props();
</script>
<HealthShell path="/policy-analysis" kicker="Policy analysis" footer={['Private analysis', 'Evidence · incentives · uncertainty']}>
  <main class="policy-page">{@render children()}</main>
</HealthShell>
<style>
  .policy-page { max-width: 1320px; margin: auto; padding: clamp(1rem, 3vw, 2.75rem); min-width: 0; }
  :global(.policy-page h1) { font-family: var(--font-display); font-size: clamp(2rem, 5vw, 3.8rem); line-height: 1.06; overflow-wrap: anywhere; margin: 1rem 0; }
  :global(.policy-page h2) { font-family: var(--font-display); font-size: var(--fs-display-xs); margin: 1.5rem 0 1rem; }
  :global(.policy-page p) { line-height: 1.65; max-width: 75ch; }
  :global(.policy-page button:focus-visible), :global(.policy-page a:focus-visible) { outline: 2px solid var(--accent); outline-offset: 3px; }
  :global(.policy-page .ruled) { padding: 1rem 0; border-bottom: 1px solid var(--line-strong); }
  :global(.policy-page .toolbar) { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; margin: 1rem 0; }
  :global(.policy-page .muted) { color: var(--text-muted); font-size: var(--fs-label); }
  :global(.policy-page .eyebrow) { font-family: var(--font-mono); color: var(--accent); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; }
  :global(.policy-page .warning) { background: var(--surface-sunken); border-left: 3px solid var(--accent); padding: .75rem 1rem; margin: .75rem 0; }
  :global(.policy-page a) { color: var(--accent-ink); overflow-wrap: anywhere; }
</style>
