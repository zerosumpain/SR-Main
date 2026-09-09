<script lang="ts">
  import ItemEditor from './ItemEditor.svelte';
  import type { EvidenceItem } from '$lib/policy-incentives-lab/schemas';
  import type { ReviewItem } from '$lib/policy-incentives-lab/validation';
  let { items, evidence, busy, approve, edit }: { items: ReviewItem[]; evidence: EvidenceItem[]; busy: boolean; approve: (ids: string[]) => void; edit: (id: string, value: string) => void } = $props();
  let selected = $state<string[]>([]);
  let drafts = $state<Record<string, string>>({});
  const title = (item: ReviewItem) => String(item.name ?? item.statement ?? item.rationale ?? item.dependency ?? item.id);
</script>
<p>Review each item and its provenance. Select only the items you approve. Editing any part of the model clears draft approvals; saved versions remain unchanged.</p>
{#each items as item (item.id)}
  <article id={`item-${item.id}`} class="review">
    <label><input type="checkbox" value={item.id} bind:group={selected} disabled={item.approval_status.status === 'approved'} /> <strong>{title(item)}</strong></label>
    <p>{item.id} · {item.approval_status.status}{#if item.approval_status.approved_by} by {item.approval_status.approved_by}{/if}</p>
    {#if 'value_or_range' in item}<p><strong>Numerical value/range:</strong> {item.value_or_range === null ? 'Unknown / not numerical' : JSON.stringify(item.value_or_range)} · Source: {String(item.source)}</p>{/if}
    {#each (Array.isArray(item.evidence_refs) ? item.evidence_refs : []) as ref}
      {@const e = evidence.find(e => e.id === ref)}
      {#if e}<blockquote><a href={`?step=evidence#evidence-${e.id}`}>{e.location} · {e.explicit_or_inferred} · {e.confidence}</a><p>{e.quotation}</p></blockquote>{:else}<p class="error">Missing evidence: {String(ref)}</p>{/if}
    {/each}
    {#if Array.isArray(item.assumption_refs) && item.assumption_refs.length}<p>Assumption references: {item.assumption_refs.join(', ')} — review in Game builder.</p>{/if}
    <details><summary>Review and amend this item</summary><ItemEditor {item} {busy} save={edit} /></details>
    <details><summary>Advanced: complete item structure</summary>
      <label>Item JSON <textarea rows="10" value={drafts[item.id] ?? JSON.stringify(item, null, 2)} oninput={e => drafts[item.id] = e.currentTarget.value}></textarea></label>
      <button disabled={busy} onclick={() => edit(item.id, drafts[item.id] ?? JSON.stringify(item))}>Save structured amendment</button>
    </details>
  </article>
{/each}
<button disabled={busy || !selected.length} onclick={() => { approve(selected); selected = []; }}>Approve selected items ({selected.length})</button>
<style>
  .review { border-top: 1px solid var(--line-strong); padding: 12px 0; scroll-margin-top: 80px; }
  textarea { width: 100%; font-family: var(--font-code); }
  blockquote { border-left: 2px solid var(--accent-ink); padding-left: 12px; margin: 12px; }
</style>
