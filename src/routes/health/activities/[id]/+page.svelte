<script lang="ts">
  // One outing, in full. Everything on it lives in ActivityDetailView — this
  // file exists to hand the loader's payload over and set the head.
  //
  // No PageHeader: the health hub wears its own sticky chrome (HealthShell),
  // and two headers stacked is two brands.
  import ActivityDetailView from '$lib/components/health/hub/ActivityDetailView.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.activity.name} — Health</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<ActivityDetailView
  activity={data.activity}
  physio={data.physio}
  segments={data.segments}
  highlights={data.highlights}
/>
