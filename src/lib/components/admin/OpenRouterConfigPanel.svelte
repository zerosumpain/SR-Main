<script lang="ts">
  let { configured, source, modelCount }:
    { configured: boolean; source: string; modelCount: number } = $props();

  let keyInput = $state('');
  let saving = $state(false);
  let errorMsg = $state<string | null>(null);
  let msg = $state<string | null>(null);

  async function saveKey() {
    saving = true; errorMsg = null; msg = null;
    try {
      const res = await fetch('/api/admin/models/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openrouterApiKey: keyInput }),
      });
      if (!res.ok) throw new Error(await res.text());
      msg = 'Key saved. Reload to see status.';
      keyInput = '';
    } catch (e: any) { errorMsg = e.message; }
    finally { saving = false; }
  }
</script>

<section
  class="p-5"
  style="background: var(--card-bg); border: 1px solid var(--line-strong); border-radius: var(--radius-round);"
>
  <h2
    class="text-sm uppercase tracking-wider mb-4"
    style="color: var(--text-ghost); font-family: var(--font-mono);"
  >
    OpenRouter API key
  </h2>

  <!-- Status line -->
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-4" style="color: var(--text-secondary);">
    <span>
      API key:
      {#if configured}
        <span
          class="ml-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider"
          style="background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); font-family: var(--font-mono);"
        >
          configured
        </span>
        <span style="color: var(--text-ghost);">({source})</span>
      {:else}
        <span
          class="ml-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider"
          style="background: var(--error-bg); color: var(--error); font-family: var(--font-mono);"
        >
          not configured
        </span>
      {/if}
    </span>
    <span>
      Cache:
      <strong style="color: var(--text-primary);">{modelCount}</strong>
      models
    </span>
  </div>

  <div class="flex flex-col gap-3">
    <label class="flex flex-col gap-1">
      <span class="text-xs" style="color: var(--text-secondary);">Update API key</span>
      <input
        class="rounded px-3 py-2 text-base"
        style="background: var(--surface-elevated); border: 1px solid var(--line-strong); color: var(--text-primary); font-family: var(--font-mono);"
        type="password"
        bind:value={keyInput}
        placeholder="sk-or-..."
        autocomplete="off"
      />
    </label>

    <div class="flex flex-wrap items-center gap-2">
      <button
        class="rounded px-4 py-2 text-sm font-medium"
        style="background: var(--accent); color: white; {saving || keyInput.length === 0 ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
        onclick={saveKey}
        disabled={saving || keyInput.length === 0}
      >
        {saving ? 'Saving…' : 'Save key'}
      </button>
      {#if msg}
        <span class="text-xs" style="color: var(--accent);">{msg}</span>
      {/if}
      {#if errorMsg}
        <span class="text-xs" style="color: var(--error);">{errorMsg}</span>
      {/if}
    </div>
  </div>
</section>
