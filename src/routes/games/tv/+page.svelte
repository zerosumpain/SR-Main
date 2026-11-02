<script lang="ts">
  import TvApp from '$lib/components/tv/TvApp.svelte';
  import TvLink from '$lib/components/tv/TvLink.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>sr. tv</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if data.linked}
  <TvApp tvName={data.tvName} family={data.family} packs={data.packs} />
{:else}
  <TvLink />
{/if}
