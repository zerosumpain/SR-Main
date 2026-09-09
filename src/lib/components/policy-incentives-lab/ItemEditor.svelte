<script lang="ts">
  import { FIELD_HELP, OPTION_LABELS } from '$lib/policy-incentives-lab/onboarding';
  import type { EvidenceItem } from '$lib/policy-incentives-lab/schemas';
  import type { ReviewItem } from '$lib/policy-incentives-lab/validation';
  let { item, busy, save, allItems, evidence }: { allItems: ReviewItem[]; evidence: EvidenceItem[]; item: ReviewItem; busy: boolean; save: (id: string, raw: string) => void } = $props();
  let value = $state<Record<string, unknown>>({});
  let numericMode = $state('unknown');
  const enums: Record<string, string[]> = { type: ['numerical', 'behavioural', 'causal', 'structural'], confidence: ['illustrative', 'user-supplied', 'unknown'], sensitivity_priority: ['high', 'medium', 'low'], desired_direction: ['increase', 'decrease', 'target'], policy_priority: ['primary', 'secondary'], information_structure: ['observable', 'hidden'], rule: ['maximise', 'satisfice', 'risk-averse', 'imitate', 'rule-based'] };
  const labels: Record<string, string> = { actor_id: 'Actor ID', outcome_metric_id: 'Outcome metric ID', weight_or_range: 'Weight assumption ID', evidence_refs: 'Evidence references (comma separated)', assumption_refs: 'Assumption references (comma separated)', actor_ids: 'Actors in decision order (comma separated)', threshold_assumption: 'Satisficing threshold assumption ID', expected_direct_effects: 'Expected direct effects', information_structure: 'Information structure' };
  const label = (key: string) => FIELD_HELP[key]?.[0] ?? labels[key] ?? key.replaceAll('_', ' ');
  const title = (i: ReviewItem) => String(i.name ?? i.statement ?? i.id);
  function optionsFor(key: string) {
    return allItems.filter(i => key === 'actor_id' || key === 'actor_ids' ? 'objectives' in i : key === 'outcome_metric_id' ? 'unit' in i : key === 'strategy_id' ? 'preconditions' in i && i.actor_id === value.actor_id : 'value_or_range' in i && i.type === 'numerical');
  }
  function setRefs(key: string, event: Event) { value[key] = Array.from((event.currentTarget as HTMLSelectElement).selectedOptions, o => o.value); }
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
      {#if ['actor_id', 'outcome_metric_id', 'weight_or_range', 'threshold_assumption'].includes(key)}<select value={String(v ?? '')} onchange={e => value[key] = e.currentTarget.value || null}><option value="">Choose an item</option>{#each optionsFor(key) as option}<option value={option.id}>{title(option)}</option>{/each}</select>
      {:else if enums[key]}<select value={String(v ?? '')} onchange={e => value[key] = e.currentTarget.value}>{#each enums[key] as option}<option value={option}>{OPTION_LABELS[option] ?? option}</option>{/each}</select>
      {:else if typeof v === 'number'}<input type="number" value={v} oninput={e => value[key] = e.currentTarget.valueAsNumber} />
      {:else if ['description', 'statement', 'rationale', 'dependency', 'measurement_limitations'].includes(key)}<textarea rows="3" value={String(v ?? '')} oninput={e => value[key] = e.currentTarget.value}></textarea>
      {:else}<input value={String(v ?? '')} oninput={e => value[key] = key === 'threshold_assumption' && !e.currentTarget.value ? null : e.currentTarget.value} />{/if}
      {#if FIELD_HELP[key]}<small>{FIELD_HELP[key][1]}</small>{/if}
    </label>
  {/each}
  {#if 'value_or_range' in item}
    <label>Numerical assumption <select value={numericMode} onchange={e => changeMode(e.currentTarget.value)}><option value="unknown">Unknown / not numerical</option><option value="point">A single illustrative or user-supplied value</option><option value="range">An uncertain range</option></select></label>
    {#if numericMode === 'point'}<label>Value <input type="number" step="any" value={Number(value.value_or_range)} oninput={e => value.value_or_range = e.currentTarget.valueAsNumber} /></label>{/if}
    {#if numericMode === 'range'}{#each ['low', 'central', 'high'] as key}<label>{key} <input type="number" step="any" value={(value.value_or_range as Record<string, number>)?.[key]} oninput={e => updateRange(key, e.currentTarget.valueAsNumber)} /></label>{/each}{/if}
    <p>Entering zero is an assumption, not a substitute for unknown. Record the value’s source and rationale before approving it.</p>
  {/if}
  {#each references as key}<label>{key === 'evidence_refs' ? 'Which source passages support this?' : key === 'assumption_refs' ? 'Which assumptions does this rely on?' : 'Who chooses, in which order?'}
    {#if key === 'actor_ids'}
      {#each value[key] as string[] as actorId, position}<label>Decision {position + 1}<select value={actorId} onchange={e => { const copy = [...value[key] as string[]]; copy[position] = e.currentTarget.value; value[key] = copy; }}>{#each optionsFor(key) as option}<option value={option.id}>{title(option)}</option>{/each}</select></label>{/each}
    {:else}<select multiple size="4" value={value[key] as string[]} onchange={e => setRefs(key, e)}>
      {#if key === 'evidence_refs'}{#each evidence as e}<option value={e.id}>{e.location}: {e.quotation.slice(0, 100)}</option>{/each}
      {:else}{#each allItems.filter(i => 'value_or_range' in i) as option}<option value={option.id}>{title(option)}</option>{/each}{/if}
    </select><small>Select all that apply. Use Ctrl or Command to choose more than one on a keyboard.</small>{/if}
  </label>{/each}
  {#each ['profile', 'outcome_values'] as group}
    {#if value[group] && typeof value[group] === 'object'}
      <fieldset><legend>{group === 'profile' ? 'Strategy choices by actor' : 'Numerical assumption for each outcome'}</legend>
      {#each Object.entries(value[group] as Record<string, string>) as [key, v]}<label>{allItems.find(i => i.id === key)?.name ?? key}<select value={v} onchange={e => value[group] = { ...(value[group] as object), [key]: e.currentTarget.value }}><option value="">Choose an item</option>{#each allItems.filter(i => group === 'profile' ? 'preconditions' in i && i.actor_id === key : 'value_or_range' in i && i.type === 'numerical') as option}<option value={option.id}>{title(option)}</option>{/each}</select></label>{/each}</fieldset>
    {/if}
  {/each}
  {#if Array.isArray(value.schedule)}
    <fieldset><legend>Rule-based schedule</legend>
      {#each value.schedule as entry, i}<div class="schedule"><label>Through round <input type="number" min="1" value={entry.through_round} oninput={e => { const copy = [...value.schedule as { through_round: number; strategy_id: string }[]]; copy[i] = { ...entry, through_round: e.currentTarget.valueAsNumber }; value.schedule = copy; }} /></label><label>Choice <select value={entry.strategy_id} onchange={e => { const copy = [...value.schedule as { through_round: number; strategy_id: string }[]]; copy[i] = { ...entry, strategy_id: e.currentTarget.value }; value.schedule = copy; }}>{#each optionsFor('strategy_id') as option}<option value={option.id}>{title(option)}</option>{/each}</select></label></div>{/each}
      <button type="button" onclick={() => value.schedule = [...value.schedule as object[], { through_round: 20, strategy_id: '' }]}>Add schedule step</button>
    </fieldset>
  {/if}
  <button disabled={busy}>Save amendment and clear draft approvals</button>
</form>
<style>small { display: block; margin-top: 6px; font-size: var(--fs-label); color: var(--text-muted); line-height: 1.5; } select { max-width: 100%; width: 100%; } input:not([type='number']), textarea { width: 100%; } label { text-transform: none; } fieldset { border: 1px solid var(--line); padding: 12px; margin: 12px 0; } .schedule { display: flex; flex-wrap: wrap; gap: 12px; }</style>
