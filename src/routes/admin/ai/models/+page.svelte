<script lang="ts">
  import OpenRouterConfigPanel from '$lib/components/admin/OpenRouterConfigPanel.svelte';
  import CodexConfigPanel from '$lib/components/admin/CodexConfigPanel.svelte';
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
    sub="Two providers: OpenRouter, billed per token, and Codex, billed to the ChatGPT Pro subscription via the local bridge. The site default is the one model every LLM task uses — chat, builder, research, workflow nodes, project pages. Set it and the chat alternate from the table; the best-combo score blends tool-use quality, price and token speed."
  />

  <div class="model-stack">
    <OpenRouterModelBrowser
      defaultModelId={data.chat.defaultModelId}
      chatAltOpenRouterModelId={data.chat.altOpenRouterModelId}
    />
    <OpenRouterConfigPanel
      configured={data.openrouterKey.configured}
      source={data.openrouterKey.source}
      modelCount={data.modelCount}
    />
    <CodexConfigPanel
      enabled={data.codex.enabled}
      health={data.codex.health}
      modelCount={data.codex.modelCount}
    />
  </div>
</PageWrap>

<style>
  .model-stack { display: flex; flex-direction: column; gap: 1rem; }
</style>
