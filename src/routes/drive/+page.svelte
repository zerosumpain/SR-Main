<script lang="ts">
  // /drive — the owner's file store, as a four-section document.
  //
  // Everything is in `DriveHub`. This file used to be 2,505 lines of markup,
  // state and CSS in one place; the split is what paid for the redesign under
  // the source-footprint budget, and it is the same shape /health uses (a thin
  // route that renders one hub component).
  import DriveHub from '$lib/components/drive/hub/DriveHub.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Drive — Strange Ramblings</title>
  <!-- Owner-gated in hooks, but the store holds private documents and a stray
       crawl of a mis-configured route should still find nothing to keep. -->
  <meta name="robots" content="noindex" />
</svelte:head>

<DriveHub {data} />
