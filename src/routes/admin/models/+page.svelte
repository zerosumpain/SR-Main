<script lang="ts">
  import { getContext } from 'svelte';
  import ModelDefaultsPanel from '$lib/components/admin/ModelDefaultsPanel.svelte';
  import OpenRouterConfigPanel from '$lib/components/admin/OpenRouterConfigPanel.svelte';
  import OpenRouterModelBrowser from '$lib/components/admin/OpenRouterModelBrowser.svelte';

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');
</script>

<svelte:head><title>Admin — LLM Models</title></svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">
  <a href="/admin?token={adminToken}" class="back-link back-link--xs mb-4">Admin</a>
  <header class="mb-6">
    <h1 class="text-2xl mb-1" style="color: var(--text-primary); font-family: var(--font-display);">LLM Models</h1>
    <p class="text-sm" style="color: var(--text-ghost);">
      Choose the models jkai uses. Chat has a default GLM model and an optional OpenRouter alternate — the in-chat toggle flips between them.
    </p>
  </header>

  <div class="flex flex-col gap-4">
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
</div>
