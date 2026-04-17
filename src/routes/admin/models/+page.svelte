<script lang="ts">
  import ModelDefaultsPanel from '$lib/components/admin/ModelDefaultsPanel.svelte';
  import OpenRouterConfigPanel from '$lib/components/admin/OpenRouterConfigPanel.svelte';
  import OpenRouterModelBrowser from '$lib/components/admin/OpenRouterModelBrowser.svelte';

  let { data } = $props();
</script>

<svelte:head><title>Models · Admin</title></svelte:head>

<div class="wrap">
  <h1>LLM Models</h1>

  <ModelDefaultsPanel chat={data.chat} builder={data.builder} />
  <OpenRouterConfigPanel
    configured={data.openrouterKey.configured}
    source={data.openrouterKey.source}
    modelCount={data.modelCount}
    lastRefreshed={data.lastRefreshed}
  />
  <OpenRouterModelBrowser />
</div>

<style>
  .wrap { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; display: flex; flex-direction: column; gap: 2rem; }
  h1 { margin: 0; }
</style>
