<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { PRODUCT_AREAS, visibleDevelopmentStage, type DeliveryState } from '$lib/jkai/development';
  let rows = $state<Array<{ buildId: string; title: string; status: string; state: DeliveryState }>>([]);
  let outcome = $state(''); let area = $state('Platform'); let filter = $state('All areas');
  let error = $state(''); let busy = $state(false); let loaded = $state(false);
  onMount(() => { void fetch('/api/jkai/development').then(async (r) => {
    if (!r.ok) throw new Error('Could not load development work'); rows = await r.json();
  }).catch((e) => error = e.message).finally(() => loaded = true); });
  async function create() {
    busy = true; error = '';
    try {
      const response = await fetch('/api/jkai/development', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome, area }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      await goto(`/jkai/develop/${result.buildId}`);
    } catch (e) { error = e instanceof Error ? e.message : 'Could not save the brief'; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>Site development — Strange Ramblings</title></svelte:head>
<section class="development">
  <header><p class="mark">SITE / DEVELOPMENT</p><h1>What should the site do next?</h1>
    <p>Commission a feature, guide its build and try the result before accepting it into your local batch.</p>
    <a href="/jkai/daydreams/backlog">Open the epic backlog →</a></header>
  <form onsubmit={(e) => { e.preventDefault(); void create(); }}>
    <label>Product area<select aria-label="Product area" bind:value={area}>{#each PRODUCT_AREAS as value}<option>{value}</option>{/each}</select></label>
    <label class="outcome">Intended outcome<textarea required maxlength="20000" bind:value={outcome} placeholder="For example: compare two weeks of health data and save the comparison."></textarea></label>
    <button class="nm-save-btn" disabled={busy}>{busy ? 'Saving…' : 'Refine this brief'}</button>
  </form>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <div class="list-heading"><h2>Development work</h2><label>Filter by area<select aria-label="Filter by area" bind:value={filter}><option>All areas</option>{#each PRODUCT_AREAS as value}<option>{value}</option>{/each}</select></label></div>
  {#if !loaded}<p role="status">Loading development work…</p>
  {:else if !rows.length}<p>No features commissioned yet. Start with an outcome above, or refine an existing epic in the backlog.</p>
  {:else}
    {#each rows.filter((r) => filter === 'All areas' || r.state.area === filter) as row}
      <a class="work-row" href={`/jkai/develop/${row.buildId}`}><span><small>{row.state.area}</small><strong>{row.title}</strong></span>
        <span>{visibleDevelopmentStage(row.state, row.status)}<small>{row.status} · {row.state.criteria.filter((c) => c.verdict === 'passed').length}/{row.state.criteria.length} criteria evidenced</small></span></a>
    {/each}
  {/if}
</section>
<style>
  .development { width: min(1100px, 100%); margin: 0 auto; padding: 24px; box-sizing: border-box; }
  header { border-bottom: 2px solid var(--line-strong); padding-bottom: 20px; margin-bottom: 24px; }
  h1 { font: clamp(1.6rem, 4vw, 2.5rem) var(--font-display); margin: 10px 0; }
  .mark, small { color: var(--text-secondary); font-size: var(--fs-label); }
  form { display: flex; gap: 16px; align-items: end; padding-bottom: 24px; }
  label { display: flex; flex-direction: column; gap: 7px; font-size: var(--fs-nav); }
  .outcome { flex: 1; } textarea { min-height: 90px; resize: vertical; }
  textarea, select { background: var(--surface-elevated); color: var(--text-primary); border: 1px solid var(--line-strong); padding: 10px; font: inherit; max-width: 100%; }
  .list-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; border-bottom: 2px solid var(--line-strong); padding: 16px 0; }
  .work-row { display: flex; justify-content: space-between; gap: 16px; padding: 18px 0; border-bottom: 1px solid var(--line); text-decoration: none; color: var(--text-primary); }
  .work-row span, .work-row strong, .work-row small { display: block; } .work-row strong { margin-top: 6px; } .error { color: var(--error); }
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  @media (max-width: 700px) { .development { padding: 16px; } form { flex-direction: column; align-items: stretch; } .list-heading, .work-row { align-items: stretch; flex-direction: column; } }
</style>
