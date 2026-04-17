<svelte:head><title>Deep Dive Settings — Admin</title></svelte:head>
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
      const body: Record<string, string> = { zaiBaseUrl, zaiModel, embeddingModel };
      if (zaiApiKey) body.zaiApiKey = zaiApiKey;
      if (tavilyApiKey) body.tavilyApiKey = tavilyApiKey;
      if (openrouterApiKey) body.openrouterApiKey = openrouterApiKey;

      const res = await fetch(`/api/admin/deepdive/keys?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const updated = await res.json();
        data.keys = updated;
        saveMsg = 'Saved';
        zaiApiKey = '';
        tavilyApiKey = '';
        openrouterApiKey = '';
        setTimeout(() => (saveMsg = ''), 3000);
      } else {
        saveMsg = 'Save failed';
      }
    } finally {
      saving = false;
    }
  }

  async function testZai() {
    zaiTest = 'testing';
    zaiTestError = '';
    try {
      const res = await fetch(`/api/admin/deepdive/test-zai?token=${adminToken}`, {
        method: 'POST',
      });
      const result = await res.json();
      if (result.success) {
        zaiTest = 'pass';
      } else {
        zaiTest = 'fail';
        zaiTestError = result.error ?? 'Unknown error';
      }
    } catch (e: any) {
      zaiTest = 'fail';
      zaiTestError = e.message ?? 'Network error';
    }
  }

  async function testTavily() {
    tavilyTest = 'testing';
    tavilyTestError = '';
    try {
      const res = await fetch(`/api/admin/deepdive/test-tavily?token=${adminToken}`, {
        method: 'POST',
      });
      const result = await res.json();
      if (result.success) {
        tavilyTest = 'pass';
      } else {
        tavilyTest = 'fail';
        tavilyTestError = result.error ?? 'Unknown error';
      }
    } catch (e: any) {
      tavilyTest = 'fail';
      tavilyTestError = e.message ?? 'Network error';
    }
  }
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <div class="flex items-center justify-between mb-10">
    <a href="/admin?token={adminToken}" class="back-link back-link--xs">Admin</a>
    <h1
      class="text-[10px] uppercase tracking-[0.3em]"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      Deep Dive Settings
    </h1>
  </div>

  <div class="space-y-6">
    <!-- Z.AI Configuration -->
    <div
      class="p-5 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p
        class="text-[10px] uppercase tracking-[0.25em] mb-4"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        Z.AI (LLM Provider)
      </p>

      <div class="space-y-3">
        <div>
          <label
            class="block text-xs mb-1"
            style="color: var(--text-muted); font-family: var(--font-mono);"
          >
            API Key {data.keys.zaiConfigured ? '(configured)' : '(not set)'}
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
          <label
            class="block text-xs mb-1"
            style="color: var(--text-muted); font-family: var(--font-mono);"
          >
            Base URL
          </label>
          <input
            type="text"
            bind:value={zaiBaseUrl}
            class="w-full px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
        </div>

        <div>
          <label
            class="block text-xs mb-1"
            style="color: var(--text-muted); font-family: var(--font-mono);"
          >
            Model
          </label>
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

    <!-- Tavily Configuration -->
    <div
      class="p-5 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p
        class="text-[10px] uppercase tracking-[0.25em] mb-4"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        Tavily (Web Search)
      </p>

      <div class="space-y-3">
        <div>
          <label
            class="block text-xs mb-1"
            style="color: var(--text-muted); font-family: var(--font-mono);"
          >
            API Key {data.keys.tavilyConfigured ? '(configured)' : '(not set)'}
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

    <!-- OpenRouter Configuration (Embeddings) -->
    <div
      class="p-5 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p
        class="text-[10px] uppercase tracking-[0.25em] mb-1"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        OpenRouter (Embeddings)
      </p>
      <p
        class="text-[9px] mb-4"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        Used for fact deduplication via pgvector. Optional — falls back to text similarity.
      </p>

      <div class="space-y-3">
        <div>
          <label
            class="block text-xs mb-1"
            style="color: var(--text-muted); font-family: var(--font-mono);"
          >
            API Key {data.keys.openrouterConfigured ? '(configured)' : '(not set)'}
          </label>
          <input
            type="password"
            bind:value={openrouterApiKey}
            placeholder={data.keys.openrouterConfigured ? '********' : 'Enter API key'}
            class="w-full px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
        </div>

        <div>
          <label
            class="block text-xs mb-1"
            style="color: var(--text-muted); font-family: var(--font-mono);"
          >
            Embedding Model
          </label>
          <input
            type="text"
            bind:value={embeddingModel}
            class="w-full px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
        </div>
      </div>
    </div>

    <!-- Save button -->
    <div class="flex items-center gap-3 justify-end">
      {#if saveMsg}
        <span
          class="text-xs"
          style="color: var(--text-ghost); font-family: var(--font-mono);"
        >
          {saveMsg}
        </span>
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
