<script lang="ts">
  import { untrack } from 'svelte';
  import type { ModelContext } from '$lib/server/models/types';

  let { chat, builder }: {
    chat: { defaultModelId: string; altOpenRouterModelId: string | null };
    builder: ModelContext;
  } = $props();

  let chatDefault = $state<string>(untrack(() => chat.defaultModelId));
  let chatAlt = $state<string | null>(untrack(() => chat.altOpenRouterModelId));
  let builderModelId = $state<string>(untrack(() => builder.modelId));

  let openrouterOptions = $state<{ id: string; name: string }[]>([]);
  let loadingOr = $state(true);
  let saving = $state(false);
  let errorMsg = $state<string | null>(null);
  let saved = $state(false);

  async function loadOpenRouter() {
    try {
      const res = await fetch('/api/admin/models/openrouter?pageSize=500&sortBy=id');
      if (res.ok) {
        const data = await res.json();
        openrouterOptions = data.rows.map((r: any) => ({ id: r.id, name: r.name }));
      }
    } finally {
      loadingOr = false;
    }
  }

  $effect(() => { loadOpenRouter(); });

  async function save() {
    saving = true; errorMsg = null; saved = false;
    try {
      const body: Record<string, unknown> = {};
      if (chatDefault !== chat.defaultModelId) body.chatDefaultModelId = chatDefault;
      if (chatAlt !== chat.altOpenRouterModelId) body.chatAltOpenRouterModelId = chatAlt;
      if (builderModelId !== builder.modelId) body.builder = { provider: 'openrouter', modelId: builderModelId };

      if (Object.keys(body).length === 0) {
        saved = true;
        setTimeout(() => (saved = false), 1500);
        return;
      }

      const res = await fetch('/api/admin/models/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      saved = true;
      setTimeout(() => (saved = false), 2500);
    } catch (e: any) {
      errorMsg = e.message ?? String(e);
    } finally {
      saving = false;
    }
  }
</script>

<section
  class="p-5"
  style="background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-round);"
>
  <h2
    class="text-sm uppercase tracking-wider mb-4"
    style="color: var(--text-ghost); font-family: var(--font-mono);"
  >
    Default models
  </h2>

  <div class="flex flex-col gap-5">
    <!-- Site default -->
    <div>
      <div
        class="text-[10px] uppercase tracking-wider mb-2"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        Site default
      </div>
      <label class="flex flex-col gap-1">
        <span class="text-xs" style="color: var(--text-secondary);">
          The OpenRouter model every chat/workflow/one-shot uses unless overridden.
          Pick from the browser below ("Set default") or here.
        </span>
        <select
          class="rounded px-3 py-2 text-sm"
          style="background: var(--surface-elevated); border: 1px solid var(--card-border); color: var(--text-primary);"
          bind:value={chatDefault}
          disabled={loadingOr}
        >
          {#if !openrouterOptions.some((m) => m.id === chatDefault)}
            <option value={chatDefault}>{chatDefault}</option>
          {/if}
          {#each openrouterOptions as m}
            <option value={m.id}>{m.name} ({m.id})</option>
          {/each}
        </select>
      </label>
    </div>

    <!-- Chat — alternate -->
    <div>
      <div
        class="text-[10px] uppercase tracking-wider mb-2"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        Chat — alternate
      </div>
      <label class="flex flex-col gap-1">
        <span class="text-xs" style="color: var(--text-secondary);">
          Optional alternate the in-chat toggle flips to — choose "(none)" to disable
        </span>
        <select
          class="rounded px-3 py-2 text-sm"
          style="background: var(--surface-elevated); border: 1px solid var(--card-border); color: var(--text-primary);"
          value={chatAlt ?? '__none__'}
          onchange={(e) => {
            const v = e.currentTarget.value;
            chatAlt = v === '__none__' ? null : v;
          }}
          disabled={loadingOr}
        >
          <option value="__none__">(none)</option>
          {#each openrouterOptions as m}
            <option value={m.id}>{m.name} ({m.id})</option>
          {/each}
        </select>
      </label>
      {#if loadingOr}
        <p class="text-[10px] mt-1" style="color: var(--text-ghost);">Loading OpenRouter models…</p>
      {/if}
    </div>

    <!-- Builder / agentic default -->
    <div>
      <div
        class="text-[10px] uppercase tracking-wider mb-2"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        Builder / agentic default
      </div>
      <label class="flex flex-col gap-1">
        <span class="text-xs" style="color: var(--text-secondary);">
          Tool-heavy agentic paths (autonomous builder, delegation) — keep this on a fast model
        </span>
        <select
          class="rounded px-3 py-2 text-sm"
          style="background: var(--surface-elevated); border: 1px solid var(--card-border); color: var(--text-primary);"
          bind:value={builderModelId}
          disabled={loadingOr}
        >
          {#if !openrouterOptions.some((m) => m.id === builderModelId)}
            <option value={builderModelId}>{builderModelId}</option>
          {/if}
          {#each openrouterOptions as m}
            <option value={m.id}>{m.name} ({m.id})</option>
          {/each}
        </select>
      </label>
    </div>

    <!-- Save row -->
    <div class="flex items-center gap-3 pt-1">
      <button
        class="rounded px-4 py-2 text-sm font-medium"
        style="background: var(--accent); color: white; {saving ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
        onclick={save}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {#if saved}
        <span class="text-xs" style="color: var(--accent);">Saved.</span>
      {/if}
      {#if errorMsg}
        <span class="text-xs" style="color: var(--error);">{errorMsg}</span>
      {/if}
    </div>
  </div>
</section>
