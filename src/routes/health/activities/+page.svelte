<script lang="ts">
  // The owner's activity ledger. Everything on it lives in ActivitiesView —
  // this file exists to hand the loader's payload over and set the head.
  //
  // No PageHeader: the health hub wears its own sticky chrome (HealthShell),
  // and two headers stacked is two brands.
  import ActivitiesView from '$lib/components/health/hub/ActivitiesView.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Activities — Strange Ramblings</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<ActivitiesView
  rows={data.rows}
  highlights={data.highlights}
  highlightsFailed={data.highlightsFailed}
  strip={data.strip}
  truncated={data.truncated}
  limit={data.limit}
  initialQuery={data.initialQuery}
  error={data.error}
/>
