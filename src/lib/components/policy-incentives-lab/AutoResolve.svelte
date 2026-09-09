<script lang="ts">
  import { onMount } from 'svelte';
  let ready = $state(false); onMount(() => { ready = true; });
  import { reviewItems } from '$lib/policy-incentives-lab/validation';
  import type { Draft } from '$lib/policy-incentives-lab/server/store';
  let { draft, busy, prepare, accept }: { draft: Draft; busy: boolean; prepare: (options: { seed: number; low: number; high: number }) => void; accept: (hash: string, ids: string[]) => void } = $props();
  let seed = $state(42); let low = $state(0); let high = $state(10); let confirmed = $state(false);
  const preview = $derived(draft.auto_resolution); const items = $derived(preview ? reviewItems(preview.proposal.candidate.game) : []);
  $effect(() => { void preview?.hash; confirmed = false; });
</script>
<section class="nm-sec" aria-label="Optional auto-resolve">
  <h3>Optional: auto-resolve for an illustrative simulation</h3>
  <p>Try the tool without choosing every number yourself. We fill missing setup, randomly sample unknown values within your range, and select a scenario. Existing known values stay in place. These are invented test assumptions, not estimates from the policy.</p>
  <form onsubmit={e => { e.preventDefault(); prepare({ seed, low, high }); }}>
    <label>Setup seed <input type="number" min="0" max="4294967295" required bind:value={seed} /></label>
    <label>Unknown values: minimum <input type="number" min="-1000000" max="1000000" step="any" required bind:value={low} /></label>
    <label>Unknown values: maximum <input type="number" min="-1000000" max="1000000" step="any" required bind:value={high} /></label>
    <p>The same illustrative range is used for missing metric values and importance weights. Check each unit and range below; a generic range may be unsuitable.</p>
    <button disabled={!ready || busy || !draft.source || low > high}>Preview automatic fixes</button>
  </form>
  {#if preview}
    <h4>Review the proposed setup</h4><p>Scenario: {preview.proposal.config.simulation_type} · {preview.proposal.config.rounds} rounds · seed {preview.proposal.seed}. No simulation has run.</p>
    <ul>{#each preview.proposal.changes as change}<li>{change}</li>{/each}</ul>
    <details open><summary>Assumptions and sampled values to accept</summary>{#each preview.proposal.candidate.game.assumptions as a}<p><strong>{a.statement}</strong><br />{a.value_or_range === null ? 'Qualitative assumption' : JSON.stringify(a.value_or_range)} · {a.confidence}<br />{a.source}</p>{/each}</details>
    <details><summary>All {items.length} model items included in this acceptance</summary>{#each items as item}<article><strong>{String(item.name ?? item.statement ?? item.id)}</strong><pre>{JSON.stringify(item, null, 2)}</pre></article>{/each}</details>
    {#if preview.proposal.errors.length}<p role="alert">Some issues need editing before this setup can be accepted:</p><ul>{#each preview.proposal.errors as error}<li>{error}</li>{/each}</ul>{/if}
    <label><input type="checkbox" bind:checked={confirmed} /> I accept the displayed model items and assumptions for an illustrative run, including their sampled numbers. This does not validate them as realistic.</label>
    <button disabled={busy || !confirmed || !!preview.proposal.errors.length} onclick={() => accept(preview.hash, items.map(i => i.id))}>Accept illustrative setup and prepare runner</button>
  {/if}
</section>
<style>pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; } article { border-top: 1px solid var(--line); } form { display: flex; flex-wrap: wrap; gap: 1rem; } form p { flex-basis: 100%; }</style>
