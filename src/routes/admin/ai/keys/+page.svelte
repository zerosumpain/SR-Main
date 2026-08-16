<svelte:head><title>API Keys — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import type { PageData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');

  let tavilyApiKey = $state('');
  let openrouterApiKey = $state('');
  let embeddingModel = $state(data.keys.embeddingModel);
  let elevenlabsApiKey = $state('');

  let saving = $state(false);
  let saveMsg = $state('');

  let tavilyTest = $state<'idle' | 'testing' | 'pass' | 'fail'>('idle');
  let tavilyTestError = $state('');

  async function saveKeys() {
    saving = true;
    saveMsg = '';
    try {
      const pending: Promise<Response>[] = [];

      const fileBody: Record<string, string> = { embeddingModel };
      if (tavilyApiKey) fileBody.tavilyApiKey = tavilyApiKey;
      if (elevenlabsApiKey) fileBody.elevenlabsApiKey = elevenlabsApiKey;
      pending.push(fetch(`/api/admin/deepdive/keys?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fileBody),
      }));

      if (openrouterApiKey) {
        pending.push(fetch(`/api/admin/models/settings?token=${adminToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openrouterApiKey }),
        }));
      }

      const results = await Promise.all(pending);
      const allOk = results.every((r) => r.ok);

      if (allOk) {
        saveMsg = 'Saved — reload to refresh status badges';
        tavilyApiKey = '';
        openrouterApiKey = '';
        elevenlabsApiKey = '';
        setTimeout(() => (saveMsg = ''), 4000);
      } else {
        saveMsg = 'Save partially failed';
      }
    } finally {
      saving = false;
    }
  }

  async function testTavily() {
    tavilyTest = 'testing';
    tavilyTestError = '';
    try {
      const res = await fetch(`/api/admin/deepdive/test-tavily?token=${adminToken}`, { method: 'POST' });
      const result = await res.json();
      if (result.success) tavilyTest = 'pass';
      else { tavilyTest = 'fail'; tavilyTestError = result.error ?? 'Unknown error'; }
    } catch (e: any) {
      tavilyTest = 'fail';
      tavilyTestError = e.message ?? 'Network error';
    }
  }
</script>

<PageWrap>
  <PageHeader
    kicker="AI Config"
    title="API Keys"
    sub="One place to update OpenRouter, ElevenLabs, and Tavily credentials. Use the in-page test buttons to verify before saving."
  >
    {#snippet actions()}
      {#if saveMsg}<span class="save-msg">{saveMsg}</span>{/if}
      <button class="nm-save-btn" onclick={saveKeys} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    {/snippet}
  </PageHeader>

  <!-- OpenRouter (primary LLM provider) -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">OpenRouter · LLM provider</span>
      <span class="nm-pill" data-state={data.keys.openrouterConfigured ? 'connected' : 'disconnected'}>
        {data.keys.openrouterConfigured ? `Configured · ${(data.keys as any).openrouterSource}` : 'Not set'}
      </span>
    </div>
    <p class="muted">Primary LLM provider — powers the /jkai orchestrator, deep-dive research, and all chat models (GLM via <code>z-ai/*</code> slugs). Also embeddings (pgvector fact dedup) and image generation (FLUX). Pick models + browse catalogue at <a class="link" href={`/admin/ai/models?token=${adminToken}`}>/admin/ai/models</a>.</p>

    <div class="nm-form-row">
      <label class="nm-field">
        <span class="sr-label-tight">API Key</span>
        <input class="nm-text-input" type="password" bind:value={openrouterApiKey}
          placeholder={data.keys.openrouterConfigured ? '********' : 'Enter API key'} />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Embedding model</span>
        <input class="nm-text-input" type="text" bind:value={embeddingModel} />
      </label>
    </div>
  </section>

  <!-- ElevenLabs -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">ElevenLabs · TTS</span>
      <span class="nm-pill" data-state={data.keys.elevenlabsConfigured ? 'connected' : 'disconnected'}>
        {data.keys.elevenlabsConfigured ? 'Configured' : 'Not set'}
      </span>
    </div>
    <p class="muted">Used by the <code>generate_audio_tts</code> tool in /jkai. Voice/model tuned via <code>JKAI_TTS_VOICE</code> / <code>JKAI_TTS_MODEL</code> env vars.</p>

    <label class="nm-field">
      <span class="sr-label-tight">API Key</span>
      <input class="nm-text-input" type="password" bind:value={elevenlabsApiKey}
        placeholder={data.keys.elevenlabsConfigured ? '********' : 'Enter API key'} />
    </label>
  </section>

  <!-- Tavily -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Tavily · Web search</span>
      <span class="nm-pill" data-state={data.keys.tavilyConfigured ? 'connected' : 'disconnected'}>
        {data.keys.tavilyConfigured ? 'Configured' : 'Not set'}
      </span>
    </div>
    <p class="muted">Used by deep-dive research tools.</p>

    <label class="nm-field">
      <span class="sr-label-tight">API Key</span>
      <input class="nm-text-input" type="password" bind:value={tavilyApiKey}
        placeholder={data.keys.tavilyConfigured ? '********' : 'Enter API key'} />
    </label>
    <div class="test-row">
      <button class="nm-btn-ghost" onclick={testTavily} disabled={tavilyTest === 'testing'}>
        {tavilyTest === 'testing' ? 'Testing…' : 'Test connection'}
      </button>
      {#if tavilyTest === 'pass'}<span class="result-ok">Pass</span>
      {:else if tavilyTest === 'fail'}<span class="result-bad">{tavilyTestError}</span>
      {/if}
    </div>
  </section>
</PageWrap>

<style>
  .muted { margin: 0; font-size: 0.85rem; color: var(--text-secondary); }
  .muted code {
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
    border-radius: 2px;
  }
  .link { color: var(--accent); text-decoration: underline; }
  .test-row { display: flex; gap: 0.7rem; align-items: center; }
  .result-ok { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--success); }
  .result-bad { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--error); }
  .save-msg { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
</style>
