<script lang="ts">
  let { configured, source, modelCount, lastRefreshed }:
    { configured: boolean; source: string; modelCount: number; lastRefreshed: string | null } = $props();

  let keyInput = $state('');
  let saving = $state(false);
  let refreshing = $state(false);
  let error = $state<string | null>(null);
  let msg = $state<string | null>(null);

  async function saveKey() {
    saving = true; error = null; msg = null;
    try {
      const res = await fetch('/api/admin/models/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openrouterApiKey: keyInput }),
      });
      if (!res.ok) throw new Error(await res.text());
      msg = 'Key saved. Reload to see status.';
      keyInput = '';
    } catch (e: any) { error = e.message; }
    finally { saving = false; }
  }

  async function refresh() {
    refreshing = true; error = null; msg = null;
    try {
      const res = await fetch('/api/admin/models/openrouter/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      msg = `Refreshed — ${data.count} models cached.`;
    } catch (e: any) { error = e.message; }
    finally { refreshing = false; }
  }
</script>

<section>
  <h2>OpenRouter</h2>

  <p class="status">
    API key: {#if configured}<strong>configured</strong> ({source}){:else}<strong class="err">not configured</strong>{/if}<br>
    Cache: <strong>{modelCount}</strong> models
    {#if lastRefreshed}· last refreshed {new Date(lastRefreshed).toLocaleString()}{/if}
  </p>

  <label>
    Update API key
    <input type="password" bind:value={keyInput} placeholder="sk-or-..." />
  </label>
  <div class="row">
    <button onclick={saveKey} disabled={saving || keyInput.length === 0}>{saving ? 'Saving…' : 'Save key'}</button>
    <button onclick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh model list'}</button>
  </div>

  {#if msg}<span class="ok">{msg}</span>{/if}
  {#if error}<span class="err">{error}</span>{/if}
</section>

<style>
  section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  h2 { margin: 0; font-size: 1.1rem; }
  .status { margin: 0; color: #444; }
  label { display: flex; flex-direction: column; gap: 0.25rem; }
  .row { display: flex; gap: 0.5rem; }
  .ok { color: green; }
  .err { color: crimson; }
</style>
