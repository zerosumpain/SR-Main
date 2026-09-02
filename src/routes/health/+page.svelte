<script lang="ts">
  // /health — one document, two audiences.
  //
  // Signed in it is the nine-section hub, A to I. Signed out it is the same
  // document one section shorter: G, Routes & plan, is not rendered, and F
  // keeps only its four count tiles. That is the whole difference, and both
  // halves of it are decided before this file — the loader builds two payloads
  // and `HealthDashboard` takes an `audience`, because `{#if owner}` in a
  // template still ships the bytes to the browser.
  //
  // Until 2026-09-02 the anonymous branch was a SEPARATE eight-chapter
  // document that lived in this file, ~640 lines of it, and it had been left
  // untouched through three redesigns of the owner's. The gap had stopped
  // being a privacy decision — none of PulseGrid, BodyTrend, the readiness
  // bars or the narrative disclosed anything — and become a maintenance one:
  // the public page was two generations behind the private one, on the same
  // URL. The components it owned went with it.
  import HealthDashboard from '$lib/components/health/hub/HealthDashboard.svelte';

  let { data } = $props();

  const owner = $derived(data.mode === 'owner');
</script>

<svelte:head>
  <title>Health — Strange Ramblings</title>
  <meta
    name="description"
    content="Live health dashboard — readiness, thirty days of body signals, cardio fitness, training load and sleep."
  />
  <meta property="og:title" content="Health — Strange Ramblings" />
  <meta
    property="og:description"
    content="Live health dashboard — readiness, thirty days of body signals, cardio fitness, training load and sleep."
  />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/health" />
  {#if owner}
    <meta name="robots" content="noindex" />
  {/if}
</svelte:head>

<HealthDashboard {data} audience={owner ? 'owner' : 'public'} />
