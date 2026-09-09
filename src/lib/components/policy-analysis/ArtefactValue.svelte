<script lang="ts">
  import type { Artefact } from '$lib/policy-analysis/contracts';
  let { value, all, inspect }: { value: unknown; all: Artefact[]; inspect: (id: string) => void } = $props();
  const label = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
</script>
{#snippet renderValue(v: unknown)}
  {#if v === null}<span class="muted">Unknown</span>
  {:else if typeof v === 'string'}
    {@const ref = all.find((a) => a.id === v)}
    {#if ref}<button class="ref" onclick={() => inspect(ref.id)}>{ref.label}</button>{:else}<span>{v}</span>{/if}
  {:else if typeof v === 'number' || typeof v === 'boolean'}<span>{String(v)}</span>
  {:else if Array.isArray(v)}
    {#if !v.length}<span class="muted">None recorded</span>{:else}<ul>{#each v as item}<li>{@render renderValue(item)}</li>{/each}</ul>{/if}
  {:else if typeof v === 'object'}
    <dl>{#each Object.entries(v) as [key, item]}<div><dt>{label(key)}</dt><dd>{@render renderValue(item)}</dd></div>{/each}</dl>
  {/if}
{/snippet}
{@render renderValue(value)}
<style>
  dl { margin: .5rem 0; } dl > div { padding: .6rem 0; border-bottom: 1px solid var(--line-hair); }
  dt { font-size: var(--fs-label); text-transform: capitalize; font-weight: 600; } dd { margin: .25rem 0 0; line-height: 1.65; overflow-wrap: anywhere; }
  ul { padding-left: 1.25rem; margin: .25rem 0; } li { margin: .25rem 0; }
  .ref { cursor: pointer; color: var(--accent-ink); text-decoration: underline; background: none; border: 0; text-align: left; font: inherit; padding: 0; }
</style>
