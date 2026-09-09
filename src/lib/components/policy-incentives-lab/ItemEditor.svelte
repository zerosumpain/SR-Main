<script lang="ts">
  import type { ReviewItem } from '$lib/policy-incentives-lab/validation';
  let { item, busy, save }: { item: ReviewItem; busy: boolean; save: (id: string, raw: string) => void } = $props();
  let value = $state<Record<string, unknown>>({});
  let numericMode = $state('unknown');
  const enums: Record<string, string[]> = { type: ['numerical', 'behavioural', 'causal', 'structural'], confidence: ['illustrative', 'user-supplied', 'unknown'], sensitivity_priority: ['high', 'medium', 'low'], desired_direction: ['increase', 'decrease', 'target'], policy_priority: ['primary', 'secondary'], information_structure: ['observable', 'hidden'], rule: ['maximise', 'satisfice', 'risk-averse', 'imitate', 'rule-based'] };
  const labels: Record<string, string> = { actor_id: 'Actor ID', outcome_metric_id: 'Outcome metric ID', weight_or_range: 'Weight assumption ID', evidence_refs: 'Evidence references (comma separated)', assumption_refs: 'Assumption references (comma separated)', actor_ids: 'Actors in decision order (comma separated)', threshold_assumption: 'Satisficing threshold assumption ID', expected_direct_effects: 'Expected direct effects', information_structure: 'Information structure' };
  const label = (key: string) => labels[key] ?? key.replaceAll('_', ' ');
  $effect(() => {
    value = JSON.parse(JSON.stringify(item));
    numericMode = item.value_or_range === null ? 'unknown' : typeof item.value_or_range === 'number' ? 'point' : 'range';
  });
  const fields = $derived(Object.entries(value).filter(([key, v]) => !['id', 'approval_status', 'approved_by_user', 'value_or_range'].includes(key) && (typeof v === 'string' || typeof v === 'number' || (key === 'threshold_assumption' && v === null))));
  const references = $derived(['evidence_refs', 'assumption_refs', 'actor_ids'].filter(k => Array.isArray(value[k])));
  function changeMode(mode: string) { numericMode = mode; value.value_or_range = mode === 'unknown' ? null : mode === 'point' ? 0 : { low: 0, central: 0, high: 0 }; }
  function updateRange(key: string, number: number) { value.value_or_range = { ...(value.value_or_range as object), [key]: number }; }
</script>
<form onsubmit={e => { e.preventDefault(); save(item.id, JSON.stringify(value)); }}>
  {#each fields as [key, v]}
    <label>{label(key)}
      {#if enums[key]}<select value={String(v ?? '')} onchange={e => value[key] = e.currentTarget.value}>{#each enums[key] as option}<option value={option}>{option}</option>{/each}</select>
      {:else if typeof v === 'number'}<input type="number" value={v} oninput={e => value[key] = e.currentTarget.valueAsNumber} />
      {:else if ['description', 'statement', 'rationale', 'dependency', 'measurement_limitations'].includes(key)}<textarea rows="3" value={String(v ?? '')} oninput={e => value[key] = e.currentTarget.value}></textarea>
      {:else}<input value={String(v ?? '')} oninput={e => value[key] = key === 'threshold_assumption' && !e.currentTarget.value ? null : e.currentTarget.value} />{/if}
    </label>
  {/each}
  {#if 'value_or_range' in item}
    <label>Numerical assumption <select value={numericMode} onchange={e => changeMode(e.currentTarget.value)}><option value="unknown">Unknown / not numerical</option><option value="point">A single illustrative or user-supplied value</option><option value="range">An uncertain range</option></select></label>
    {#if numericMode === 'point'}<label>Value <input type="number" step="any" value={Number(value.value_or_range)} oninput={e => value.value_or_range = e.currentTarget.valueAsNumber} /></label>{/if}
    {#if numericMode === 'range'}{#each ['low', 'central', 'high'] as key}<label>{key} <input type="number" step="any" value={(value.value_or_range as Record<string, number>)?.[key]} oninput={e => updateRange(key, e.currentTarget.valueAsNumber)} /></label>{/each}{/if}
    <p>Entering zero is an assumption, not a substitute for unknown. Record the value’s source and rationale before approving it.</p>
  {/if}
  {#each references as key}<label>{label(key)} <input value={(value[key] as string[]).join(', ')} oninput={e => value[key] = e.currentTarget.value.split(',').map(v => v.trim()).filter(Boolean)} /></label>{/each}
  {#each ['profile', 'outcome_values'] as group}
    {#if value[group] && typeof value[group] === 'object'}
      <fieldset><legend>{group === 'profile' ? 'Strategy choices by actor' : 'Numerical assumption for each outcome'}</legend>
      {#each Object.entries(value[group] as Record<string, string>) as [key, v]}<label>{key} <input value={v} oninput={e => value[group] = { ...(value[group] as object), [key]: e.currentTarget.value }} /></label>{/each}</fieldset>
    {/if}
  {/each}
  {#if Array.isArray(value.schedule)}
    <fieldset><legend>Rule-based schedule</legend>
      {#each value.schedule as entry, i}<div class="schedule"><label>Through round <input type="number" min="1" value={entry.through_round} oninput={e => { const copy = [...value.schedule as { through_round: number; strategy_id: string }[]]; copy[i] = { ...entry, through_round: e.currentTarget.valueAsNumber }; value.schedule = copy; }} /></label><label>Strategy ID <input value={entry.strategy_id} oninput={e => { const copy = [...value.schedule as { through_round: number; strategy_id: string }[]]; copy[i] = { ...entry, strategy_id: e.currentTarget.value }; value.schedule = copy; }} /></label></div>{/each}
      <button type="button" onclick={() => value.schedule = [...value.schedule as object[], { through_round: 20, strategy_id: '' }]}>Add schedule step</button>
    </fieldset>
  {/if}
  <button disabled={busy}>Save amendment and clear draft approvals</button>
</form>
<style>input:not([type='number']), textarea { width: 100%; } label { text-transform: none; } fieldset { border: 1px solid var(--line); padding: 12px; margin: 12px 0; } .schedule { display: flex; flex-wrap: wrap; gap: 12px; }</style>
