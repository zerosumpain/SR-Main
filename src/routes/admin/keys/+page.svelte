<svelte:head><title>API Keys — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import type { PageData } from './$types';

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

      // Z.AI, Tavily, ElevenLabs, embedding model → keys.json
      const fileBody: Record<string, string> = { zaiBaseUrl, zaiModel, embeddingModel };
      if (zaiApiKey) fileBody.zaiApiKey = zaiApiKey;
      if (tavilyApiKey) fileBody.tavilyApiKey = tavilyApiKey;
      if (elevenlabsApiKey) fileBody.elevenlabsApiKey = elevenlabsApiKey;
      pending.push(fetch(`/api/admin/deepdive/keys?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fileBody),
      }));

      // OpenRouter → DB (app_settings.openrouter.api_key) via the models settings endpoint
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
        saveMsg = 'Saved — reload to see status';
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
      if (result.success) { zaiTest = 'pass'; }
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
      if (result.success) { tavilyTest = 'pass'; }
      else { tavilyTest = 'fail'; tavilyTestError = result.error ?? 'Unknown error'; }
    } catch (e: any) {
      tavilyTest = 'fail';
      tavilyTestError = e.message ?? 'Network error';
    }
  }

  function statusLabel(configured: boolean): string {
    return configured ? '(configured)' : '(not set)';
  }
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <div class="flex items-center justify-between mb-10">
    <a href="/admin?token={adminToken}" class="back-link back-link--xs">Admin</a>
    <h1
      class="text-[10px] uppercase tracking-[0.3em]"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      API Keys
    </h1>
  </div>

  <div class="space-y-6">
    <!-- Z.AI -->
    <div class="p-5 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
      <p class="text-[10px] uppercase tracking-[0.25em] mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Z.AI (LLM Provider)
      </p>
      <p class="text-[9px] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Primary chat model. Used by /jkai orchestrator and deep-dive research.
      </p>

      <div class="space-y-3">
        <div>
          <label class="block text-xs mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">
            API Key {statusLabel(data.keys.zaiConfigured)}
          </label>
          <input
            type="password"
            bind:value={zaiApiKey}
            placeholder={data.keys.zaiConfigured ? '********' : 'Enter API key'}
            class="w-full px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">Base URL</label>
          <input
            type="text"
            bind:value={zaiBaseUrl}
            class="w-full px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">Model</label>
          <input
            type="text"
            bind:value={zaiModel}
            class="w-full px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
        </div>

        <div class="flex items-center gap-3">
          <button
            onclick={testZai}
            disabled={zaiTest === 'testing'}
            class="text-[10px] uppercase tracking-[0.2em] px-3 py-2 rounded-lg transition-colors"
            style="background: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          >
            {zaiTest === 'testing' ? 'Testing...' : 'Test connection'}
          </button>
          {#if zaiTest === 'pass'}
            <span style="color: #2d7d46; font-family: var(--font-mono);" class="text-sm">Pass</span>
          {:else if zaiTest === 'fail'}
            <span style="color: #8b3a1a; font-family: var(--font-mono);" class="text-xs">{zaiTestError}</span>
          {/if}
        </div>
      </div>
    </div>

    <!-- OpenRouter -->
    <div class="p-5 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
      <p class="text-[10px] uppercase tracking-[0.25em] mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
        OpenRouter
      </p>
      <p class="text-[9px] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Alternate chat models, embeddings (pgvector fact dedup), and image generation (FLUX).
      </p>

      <div class="space-y-3">
        <div>
          <label class="block text-xs mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">
            API Key {statusLabel(data.keys.openrouterConfigured)}
            {#if data.keys.openrouterConfigured}
              <span class="ml-1 text-[9px] opacity-70">[stored in {(data.keys as any).openrouterSource}]</span>
            {/if}
          </label>
          <input
            type="password"
            bind:value={openrouterApiKey}
            placeholder={data.keys.openrouterConfigured ? '********' : 'Enter API key'}
            class="w-full px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
          <p class="text-[9px] mt-1 opacity-60" style="color: var(--text-ghost); font-family: var(--font-mono);">
            Saves to app_settings table (primary). Takes effect immediately. Also used by /admin/models.
          </p>
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">Embedding Model</label>
          <input
            type="text"
            bind:value={embeddingModel}
            class="w-full px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
        </div>
      </div>
    </div>

    <!-- ElevenLabs -->
    <div class="p-5 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
      <p class="text-[10px] uppercase tracking-[0.25em] mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
        ElevenLabs (Text-to-Speech)
      </p>
      <p class="text-[9px] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Used by the <code>generate_audio_tts</code> tool in /jkai. Voice/model tuned via <code>JKAI_TTS_VOICE</code> / <code>JKAI_TTS_MODEL</code> env vars.
      </p>

      <div class="space-y-3">
        <div>
          <label class="block text-xs mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">
            API Key {statusLabel(data.keys.elevenlabsConfigured)}
          </label>
          <input
            type="password"
            bind:value={elevenlabsApiKey}
            placeholder={data.keys.elevenlabsConfigured ? '********' : 'Enter API key'}
            class="w-full px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
        </div>
      </div>
    </div>

    <!-- Tavily -->
    <div class="p-5 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
      <p class="text-[10px] uppercase tracking-[0.25em] mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Tavily (Web Search)
      </p>
      <p class="text-[9px] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Used by deep-dive research tools.
      </p>

      <div class="space-y-3">
        <div>
          <label class="block text-xs mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">
            API Key {statusLabel(data.keys.tavilyConfigured)}
          </label>
          <input
            type="password"
            bind:value={tavilyApiKey}
            placeholder={data.keys.tavilyConfigured ? '********' : 'Enter API key'}
            class="w-full px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
        </div>

        <div class="flex items-center gap-3">
          <button
            onclick={testTavily}
            disabled={tavilyTest === 'testing'}
            class="text-[10px] uppercase tracking-[0.2em] px-3 py-2 rounded-lg transition-colors"
            style="background: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          >
            {tavilyTest === 'testing' ? 'Testing...' : 'Test connection'}
          </button>
          {#if tavilyTest === 'pass'}
            <span style="color: #2d7d46; font-family: var(--font-mono);" class="text-sm">Pass</span>
          {:else if tavilyTest === 'fail'}
            <span style="color: #8b3a1a; font-family: var(--font-mono);" class="text-xs">{tavilyTestError}</span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Save button -->
    <div class="flex items-center gap-3 justify-end">
      {#if saveMsg}
        <span class="text-xs" style="color: var(--text-ghost); font-family: var(--font-mono);">{saveMsg}</span>
      {/if}
      <button
        onclick={saveKeys}
        disabled={saving}
        class="text-[10px] uppercase tracking-[0.2em] px-5 py-3 rounded-lg transition-colors disabled:opacity-50"
        style="background: var(--accent); color: white; font-family: var(--font-mono);"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  </div>
</div>
