<script lang="ts">
  // The record — three sections, read top to bottom. Which document you get is
  // decided in the loader, not here; see `ReleasesHub` for the shape of each.
  import ReleasesHub from '$lib/components/releases/hub/ReleasesHub.svelte';

  let { data } = $props();

  const owner = $derived(data.mode === 'owner');

  function fmt(n: number): string {
    return n.toLocaleString('en-GB');
  }
</script>

<svelte:head>
  <title>{owner ? 'Releases · console' : 'Shipped · Strange Ramblings'}</title>
  {#if data.mode === 'public'}
    <meta
      name="description"
      content="Every production deploy of strangeramblings.com — {fmt(
        data.totals.releases,
      )} releases and {fmt(
        data.totals.shipped,
      )} shipped capabilities, generated from the deployed commit range."
    />
    <meta property="og:title" content="Shipped · Strange Ramblings" />
    <meta
      property="og:description"
      content="{fmt(data.totals.releases)} releases over {fmt(
        data.totals.days,
      )} days, and what each one put live."
    />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://strangeramblings.com/releases" />
  {:else}
    <!-- The owner view carries commit prose and file paths. It is the same URL
         as the public document, so it has to say so to a crawler that arrives
         holding a session. -->
    <meta name="robots" content="noindex" />
  {/if}
</svelte:head>

<ReleasesHub {data} />
