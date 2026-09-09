<script lang="ts">
  import type { PolicyGame } from '$lib/policy-incentives-lab/schemas';
  let { game, parameters = $bindable('{}'), ranges = $bindable('[]') }: { game?: PolicyGame; parameters?: string; ranges?: string } = $props();
  const uncertain = $derived(game?.assumptions.filter(a => a.type === 'numerical' && a.value_or_range !== null && typeof a.value_or_range === 'object') ?? []);
  let selected = $state(''); let low = $state<number>(); let high = $state<number>(); let steps = $state(5);
  $effect(() => { game; selected = ''; ranges = '[]'; parameters = '{}'; });
  function override(id: string, input: HTMLInputElement) {
    const values = JSON.parse(parameters); if (input.value === '') delete values[id]; else values[id] = input.valueAsNumber;
    parameters = JSON.stringify(values);
  }
  function choose(id: string) {
    selected = id; const range = uncertain.find(a => a.id === id)?.value_or_range;
    if (range && typeof range === 'object') { low = range.low; high = range.high; }
    updateRange();
  }
  function updateRange() { ranges = selected ? JSON.stringify([{ assumption_id: selected, low, high, steps }]) : '[]'; }
</script>
<h3>Change an uncertain value for this scenario</h3>
<p>Leave a box empty to use its approved middle value. You can only choose values inside a range you have approved.</p>
{#each uncertain as assumption}{@const range = assumption.value_or_range as { low: number; central: number; high: number }}
  <label>{assumption.statement}<input type="number" step="any" min={range.low} max={range.high} placeholder={String(range.central)} oninput={e => override(assumption.id, e.currentTarget)} /><small>Approved range: {range.low} to {range.high}; middle: {range.central}. Source: {assumption.source}</small></label>
{:else}<p>No approved uncertain ranges in this snapshot. To try other values, revise an assumption and approve a new snapshot.</p>{/each}
<h3>Check whether one uncertain value changes the answer</h3>
<p>This tries several evenly spaced values, one assumption at a time. It does not estimate how probable those values are.</p>
<label>Which assumption should we vary?<select value={selected} onchange={e => choose(e.currentTarget.value)}><option value="">Choose an approved uncertain assumption</option>{#each uncertain as a}<option value={a.id}>{a.statement}</option>{/each}</select></label>
{#if selected}<div class="range"><label>Lowest value<input type="number" step="any" value={low} oninput={e => { low = e.currentTarget.valueAsNumber; updateRange(); }} /></label><label>Highest value<input type="number" step="any" value={high} oninput={e => { high = e.currentTarget.valueAsNumber; updateRange(); }} /></label><label>How many values to try?<input type="number" min="2" max="11" value={steps} oninput={e => { steps = e.currentTarget.valueAsNumber; updateRange(); }} /></label></div>{/if}
<style>small { display: block; font-size: var(--fs-label); line-height: 1.5; color: var(--text-muted); } .range { display: flex; flex-wrap: wrap; gap: 16px; } select { width: 100%; }</style>
