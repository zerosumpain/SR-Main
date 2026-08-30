<script lang="ts">
  // The owner's segments explorer. Everything on it lives in SegmentsView —
  // this file exists to hand the loader's payload over and set the head.
  //
  // No PageHeader: the health hub wears its own sticky chrome (HealthShell),
  // and two headers stacked is two brands.
  import SegmentsView from '$lib/components/health/hub/SegmentsView.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Segments — Strange Ramblings</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<SegmentsView
  segments={data.segments}
  types={data.types}
  chains={data.chains}
  truncated={data.truncated}
  limit={data.limit}
  initialQuery={data.initialQuery}
  error={data.error}
/>
