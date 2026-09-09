<script lang="ts">
  import NetworkGraph from '$lib/components/intel/NetworkGraph.svelte';
  import type { NetNode, NetEdge } from '$lib/codegraph/types';
  import type { PolicyGame } from '$lib/policy-incentives-lab/schemas';
  let { game, onSelect }: { game: PolicyGame; onSelect: (id: string) => void } = $props();
  const nodes: NetNode[] = $derived(game.actors.map(a => ({ id: a.id, name: a.name, type: 'actor', typeId: 'actor', icon: '', color: 'var(--accent-ink)', summary: a.description, confirmed: a.approval_status.status === 'approved', confidence: 'user-reviewed model item', noteCount: a.evidence_refs.length, degree: 1, importance: 1, betweenness: 0, brokerage: 0, community: 0, hops: null, categories: [], aliases: [], sources: [], recency: 1 })));
  const edges: NetEdge[] = $derived(game.interactions.flatMap(i => i.actor_ids.slice(1).map((a, n) => ({ id: `${i.id}-${n}`, source: i.actor_ids[n], target: a, type: 'interaction', label: i.dependency, strength: 'configured', confidence: 'assumption', crossCommunity: false, weight: 1, recency: 1, sourceKind: null }))));
</script>
<p>Actor nodes and configured interaction links. Layout and equal node sizes have no analytical meaning. Select an actor, or use the equivalent buttons below.</p>
<div class="network"><NetworkGraph {nodes} {edges} onSelect={(id) => { if (id) onSelect(id); }} /></div>
<div>{#each game.actors as a}<button onclick={() => onSelect(a.id)}>{a.name}</button>{/each}</div>
<ul>{#each game.interactions as i}<li>{i.actor_ids.join(' → ')}: {i.dependency} ({i.information_structure})</li>{/each}</ul>
<style>.network { height: 440px; min-width: 0; position: relative; border: 1px solid var(--line); }</style>
