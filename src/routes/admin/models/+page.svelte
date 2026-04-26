<script lang="ts">
  import ModelDefaultsPanel from '$lib/components/admin/ModelDefaultsPanel.svelte';
  import OpenRouterConfigPanel from '$lib/components/admin/OpenRouterConfigPanel.svelte';
  import OpenRouterModelBrowser from '$lib/components/admin/OpenRouterModelBrowser.svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data } = $props();
</script>

<svelte:head><title>LLM Models — Admin</title></svelte:head>

<PageWrap width="wide">
  <PageHeader
    kicker="AI Config"
    title="LLM Models"
    sub="Choose the models jkai uses. Chat has a default GLM model and an optional OpenRouter alternate — the in-chat toggle flips between them."
  />

  <div class="model-stack">
    <ModelDefaultsPanel chat={data.chat} builder={data.builder} />
    <OpenRouterConfigPanel
      configured={data.openrouterKey.configured}
      source={data.openrouterKey.source}
      modelCount={data.modelCount}
      lastRefreshed={data.lastRefreshed}
    />
    <OpenRouterModelBrowser
      chatAltOpenRouterModelId={data.chat.altOpenRouterModelId}
      builderModelId={data.builder.provider === 'openrouter' ? data.builder.modelId : null}
    />
  </div>
</PageWrap>

<style>
  .model-stack { display: flex; flex-direction: column; gap: 1rem; }
</style>
