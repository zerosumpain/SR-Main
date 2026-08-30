<script lang="ts">
  // One piece of ground, in full. Everything on it lives in SegmentDetailView —
  // this file exists to hand the loader's payload over and set the head.
  //
  // No PageHeader: the health hub wears its own sticky chrome (HealthShell),
  // and two headers stacked is two brands.
  import SegmentDetailView from '$lib/components/health/hub/SegmentDetailView.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.segment.name} — Health</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<SegmentDetailView
  segment={data.segment}
  similar={data.similar}
  gradientBands={data.gradientBands}
/>
