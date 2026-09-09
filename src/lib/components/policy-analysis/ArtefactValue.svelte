<script lang="ts">
  // The structured fields behind an artefact, rendered for a reader rather than
  // for a debugger.
  //
  // Two things this used to get wrong. Keys were prettified and values were not,
  // so a policy professional opening "Details" met a wall of `metric_gaming`,
  // `minimum_compliance` and `0.65`. And every string was checked against the
  // artefact list, so an identifier that happened not to resolve was printed raw.
  //
  // Values are only reworded when they are a KNOWN vocabulary term — the enums
  // the contracts define — because `s10_3_exploit` is a perfectly good string
  // containing underscores and must not be turned into prose. Numbers are only
  // shown as percentages under the keys that are defined on [0,1].
  import { ORIGINS, RELATIONS, PATTERNS, SCENARIOS, LEGALITY, CROSS_PATTERNS, type Artefact } from '$lib/policy-analysis/contracts';

  let { value, all, inspect }: { value: unknown; all: Artefact[]; inspect: (id: string) => void } = $props();

  const VOCABULARY = new Set<string>([
    ...ORIGINS, ...RELATIONS, ...PATTERNS, ...SCENARIOS, ...LEGALITY, ...CROSS_PATTERNS,
    'objective', 'problem', 'responsibility', 'decision_right', 'funding', 'dependency', 'data_flow', 'measure', 'constraint', 'risk', 'benefit', 'claim', 'cited_evidence',
    'person', 'department', 'agency', 'local_authority', 'provider', 'contractor', 'programme', 'dataset', 'legislation', 'committee', 'user_group', 'geography', 'concept',
    'supports', 'contradicts', 'mixed', 'insufficient', 'low_risk', 'moderate_risk', 'high_risk', 'indeterminate',
    'low', 'moderate', 'high', 'unknown', 'proposed', 'current', 'historical', 'inferred', 'full_text', 'search_excerpt',
    'severe', 'significant', 'limited', 'compliant', 'grey', 'breach',
  ]);

  /** Fields the contracts define on [0,1] — the only numbers that are shares. */
  const SHARES = new Set(['importance', 'uncertainty', 'consequence', 'priority', 'severity', 'incentive', 'ease', 'impact', 'concealment', 'exposure', 'confidence', 'difficulty', 'likelihood']);

  const label = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
  const term = (v: string) => (VOCABULARY.has(v) ? v.replaceAll('_', ' ') : v);
</script>

{#snippet renderValue(v: unknown, key: string)}
  {#if v === null}<span class="muted">Not established</span>
  {:else if typeof v === 'string'}
    {@const ref = all.find((a) => a.id === v)}
    {#if ref}<button class="ref" onclick={() => inspect(ref.id)}>{ref.label}</button>
    {:else if !v}<span class="muted">Not established</span>
    {:else}<span class:term={VOCABULARY.has(v)}>{term(v)}</span>{/if}
  {:else if typeof v === 'number'}
    {#if SHARES.has(key) && v >= 0 && v <= 1}<span class="figure">{Math.round(v * 100)}%</span>{:else}<span class="figure">{v}</span>{/if}
  {:else if typeof v === 'boolean'}<span>{v ? 'Yes' : 'No'}</span>
  {:else if Array.isArray(v)}
    {#if !v.length}<span class="muted">None recorded</span>{:else}<ul>{#each v as item, i (i)}<li>{@render renderValue(item, key)}</li>{/each}</ul>{/if}
  {:else if typeof v === 'object'}
    <dl>{#each Object.entries(v) as [k, item] (k)}<div><dt>{label(k)}</dt><dd>{@render renderValue(item, k)}</dd></div>{/each}</dl>
  {/if}
{/snippet}

{@render renderValue(value, '')}

<style>
  dl { margin: .5rem 0; } dl > div { padding: .6rem 0; border-bottom: 1px solid var(--line-hair); }
  dt { font-size: var(--fs-label); text-transform: capitalize; font-weight: 600; } dd { margin: .25rem 0 0; line-height: 1.65; overflow-wrap: anywhere; }
  ul { padding-left: 1.25rem; margin: .25rem 0; } li { margin: .25rem 0; }
  .term { text-transform: capitalize; }
  .figure { font-family: var(--font-mono); }
  .muted { color: var(--text-muted); }
  .ref { cursor: pointer; color: var(--accent-ink); text-decoration: underline; background: none; border: 0; text-align: left; font: inherit; padding: 0; }
</style>
