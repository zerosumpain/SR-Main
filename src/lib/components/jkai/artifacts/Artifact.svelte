<script lang="ts">
  import type { Artifact } from '$lib/workflows/site-tools/artifact-types';
  import ChartArtifact from './ChartArtifact.svelte';
  import MapArtifact from './MapArtifact.svelte';
  import TableArtifact from './TableArtifact.svelte';
  import DiagramArtifact from './DiagramArtifact.svelte';

  let { artifact }: { artifact: Artifact } = $props();
</script>

{#if artifact.type === 'chart'}
  <ChartArtifact {artifact} />
{:else if artifact.type === 'map'}
  <MapArtifact {artifact} />
{:else if artifact.type === 'table'}
  <TableArtifact {artifact} />
{:else if artifact.type === 'diagram'}
  <DiagramArtifact {artifact} />
{/if}
