<svelte:head><title>API Keys — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import type { PageData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');

  let zaiApiKey = $state('');
  let zaiBaseUrl = $state(data.keys.zaiBaseUrl);
  let zaiModel = $state(data.keys.zaiModel);
  let tavilyApiKey = $state('');
  let openrouterApiKey = $state('');
  let embeddingModel = $state(data.keys.embeddingModel);
  let elevenlabsApiKey = $state('');

  let saving = $state(false);
  let saveMsg = $state('');

  let zaiTest = $state<'idle' | 'testing' | 'pass' | 'fail'>('idle');
  let zaiTestError = $state('');
  let tavilyTest = $state<'idle' | 'testing' | 'pass' | 'fail'>('idle');
  let tavilyTestError = $state('');

  async function saveKeys() {
    saving = true;
    saveMsg = '';
    try {
      const pending: Promise<Response>[] = [];

      const fileBody: Record<string, string> = { zaiBaseUrl, zaiModel, embeddingModel };
      if (zaiApiKey) fileBody.zaiApiKey = zaiApiKey;
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
        zaiApiKey = '';
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

  async function testZai() {
    zaiTest = 'testing';
    zaiTestError = '';
    try {
      const res = await fetch(`/api/admin/deepdive/test-zai?token=${adminToken}`, { method: 'POST' });
      const result = await res.json();
      if (result.success) zaiTest = 'pass';
      else { zaiTest = 'fail'; zaiTestError = result.error ?? 'Unknown error'; }
    } catch (e: any) {
      zaiTest = 'fail';
      zaiTestError = e.message ?? 'Network error';
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
    sub="One place to update Z.AI, OpenRouter, ElevenLabs, and Tavily credentials. Use the in-page test buttons to verify before saving."
  >
    {#snippet actions()}
      {#if saveMsg}<span class="save-msg">{saveMsg}</span>{/if}
      <button class="nm-save-btn" onclick={saveKeys} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    {/snippet}
  </PageHeader>

  <!-- Z.AI -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Z.AI · LLM provider</span>
      <span class="nm-pill" data-state={data.keys.zaiConfigured ? 'connected' : 'disconnected'}>
        {data.keys.zaiConfigured ? 'Configured' : 'Not set'}
      </span>
    </div>
    <p class="muted">Primary chat model. Used by /jkai orchestrator and deep-dive research.</p>

    <div class="nm-form-row">
      <label class="nm-field">
        <span class="sr-label-tight">API Key</span>
        <input class="nm-text-input" type="password" bind:value={zaiApiKey}
          placeholder={data.keys.zaiConfigured ? '********' : 'Enter API key'} />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Base URL</span>
        <input class="nm-text-input" type="text" bind:value={zaiBaseUrl} />
      </label>
    </div>
    <label class="nm-field">
      <span class="sr-label-tight">Model</span>
      <input class="nm-text-input" type="text" bind:value={zaiModel} />
    </label>
    <div class="test-row">
      <button class="nm-btn-ghost" onclick={testZai} disabled={zaiTest === 'testing'}>
        {zaiTest === 'testing' ? 'Testing…' : 'Test connection'}
      </button>
      {#if zaiTest === 'pass'}<span class="result-ok">Pass</span>
      {:else if zaiTest === 'fail'}<span class="result-bad">{zaiTestError}</span>
      {/if}
    </div>
  </section>

  <!-- OpenRouter -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">OpenRouter</span>
      <span class="nm-pill" data-state={data.keys.openrouterConfigured ? 'connected' : 'disconnected'}>
        {data.keys.openrouterConfigured ? `Configured · ${(data.keys as any).openrouterSource}` : 'Not set'}
      </span>
    </div>
    <p class="muted">Alternate chat models, embeddings (pgvector fact dedup), and image generation (FLUX). Pick models + browse catalogue at <a class="link" href={`/admin/models?token=${adminToken}`}>/admin/models</a>.</p>

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
    font-size: 0.85em;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
    border-radius: 2px;
  }
  .link { color: var(--accent); text-decoration: underline; }
  .test-row { display: flex; gap: 0.7rem; align-items: center; }
  .result-ok { font-family: var(--font-mono); font-size: 11px; color: #2d7a3a; }
  .result-bad { font-family: var(--font-mono); font-size: 11px; color: #c44; }
  .save-msg { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
</style>
