<script lang="ts">
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import type { ThreadGraph } from '$lib/jkai/thread-graph';
  let { artefacts, inspect }: { artefacts: Artefact[]; inspect: (id: string) => void } = $props();
  let focus = $state(''); let open = $state(false); let selected = $state<string | null>(null);
  const edges = $derived(artefacts.filter((a) => a.kind === 'edge'));
  const name = (id: string | null) => entities.find((a) => a.id === id)?.label ?? id;

  const entities = $derived(artefacts.filter((a) => edges.some((e) => e.fromId === a.id || e.toId === a.id)));
  const visible = $derived(edges.filter((e) => !focus || e.fromId === focus || e.toId === focus));
  // The visual holds 30 nodes. Taking the first 30 to arrive showed whichever
  // entities the extractor happened to emit early; ranking by how many
  // assertions touch them shows the ones the policy actually runs through.
  const degree = $derived(visible.reduce((counts: Record<string, number>, e) => {
    for (const end of [e.fromId!, e.toId!]) counts[end] = (counts[end] ?? 0) + 1;
    return counts;
  }, {}));
  const ranked = $derived([...new Set(visible.flatMap((e) => [e.fromId!, e.toId!]))].sort((a, b) => (degree[b] ?? 0) - (degree[a] ?? 0) || a.localeCompare(b)));
  const nodeIds = $derived(ranked.slice(0, 30));
  const ordered = $derived([...visible].sort((a, b) => (degree[b.fromId!] ?? 0) - (degree[a.fromId!] ?? 0) || (name(a.fromId) ?? '').localeCompare(name(b.fromId) ?? '')));
  const graph = $derived<ThreadGraph>({
    nodes: entities.filter((a) => nodeIds.includes(a.id)).map((a) => ({ id: `policy:${a.id}`, kind: 'artefact', type: a.kind, name: a.label, note: `${a.origin.replaceAll('_', ' ')} · ${a.statement}`, href: null, provenance: 'thread', lastSeen: null, turns: [], mentions: edges.filter((e) => e.fromId === a.id || e.toId === a.id).length })),
    edges: visible.filter((e) => nodeIds.includes(e.fromId!) && nodeIds.includes(e.toId!)).map((e) => ({ source: `policy:${e.fromId}`, target: `policy:${e.toId}`, verb: e.relation!.replaceAll('_', ' '), typed: true })),
    conceptsReady: true, intelEnabled: false, conceptTotal: entities.length,
  });
</script>
<div class="toolbar">
  <label for="graph-actor">Focus actor or mechanism</label>
  <select id="graph-actor" class="nm-text-input" bind:value={focus}><option value="">All relationships</option>{#each entities as entity}<option value={entity.id}>{entity.label}</option>{/each}</select>
  <button class="nm-save-btn" onclick={() => open = true} disabled={!edges.length}>Open graph</button>
</div>
<p class="muted">
  {entities.length} connected entities · {edges.length} assertions.
  {#if ranked.length > 30}The visual draws the 30 most connected of {ranked.length}; the other {ranked.length - 30} are absent from the picture but present in the list below.{:else}The visual draws all {ranked.length} connected entities.{/if}
  Focus one to inspect its neighbourhood. Every assertion is listed here regardless.
</p>
{#each ordered as edge (edge.id)}
  <div class="ruled"><button class="edge" onclick={() => inspect(edge.id)}>{name(edge.fromId)} → {edge.relation?.replaceAll('_', ' ')} → {name(edge.toId)}</button><div class="muted">{edge.temporal} · {edge.origin.replaceAll('_', ' ')} · confidence {edge.confidence ?? 'unknown'}</div></div>
{:else}<p class="muted">No graph assertions are available yet.</p>{/each}
{#if open}
  {#await import('$lib/components/jkai/KnowledgeGraphModal.svelte')}<p role="status">Opening graph…</p>
  {:then module}<module.default exploreHref={null} {graph} selectedId={selected} onSelect={(id) => { selected = id; inspect(id.replace(/^policy:/, '')); }} onClose={() => open = false} />
  {:catch}<p role="alert">The visual could not load. Use the relationship list to inspect every assertion.</p>{/await}
{/if}
<style>
  select { max-width: 26rem; } .edge { font: inherit; color: var(--accent-ink); text-align: left; background: none; border: 0; cursor: pointer; padding: .25rem 0; overflow-wrap: anywhere; }
</style>
