<script lang="ts">
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();
  let channelList = $state(data.channels);

  let showAddDialog = $state(false);
  let newKind: 'whatsapp' | 'email' = $state('email');
  let newName = $state('');
  let creating = $state(false);

  const STATUS_COLORS: Record<string, string> = {
    connected: 'var(--success)',
    ready: 'var(--success)',
    connecting: 'var(--warn)',
    qr_pending: 'var(--warn)',
    unconfigured: 'var(--warn)',
    disconnected: 'var(--error)',
    unknown: 'var(--text-ghost)',
  };

  const KIND_LABELS: Record<string, string> = {
    whatsapp: 'WhatsApp',
    email: 'Email',
  };

  function configurePath(kind: string, id: string): string {
    if (kind === 'whatsapp') return `/jkai/channels/whatsapp/${id}`;
    if (kind === 'email') return `/jkai/channels/email/${id}`;
    return '/jkai/channels';
  }

  async function toggleEnabled(ch: typeof channelList[number], next: boolean) {
    try {
      const res = await fetch(`/api/channels/${ch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) {
        channelList = channelList.map((c) => (c.id === ch.id ? { ...c, enabled: next } : c));
      }
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  }

  async function deleteChannel(id: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this channel?')) return;
    try {
      const res = await fetch(`/api/channels/${id}`, { method: 'DELETE' });
      if (res.ok) {
        channelList = channelList.filter((c) => c.id !== id);
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  async function createChannel() {
    if (!newName.trim()) return;
    creating = true;
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: newKind, name: newName.trim(), enabled: true, config: {} }),
      });
      if (res.ok) {
        const payload = await res.json();
        const created = payload.channel;
        channelList = [{ ...created, status: newKind === 'whatsapp' ? 'disconnected' : 'unconfigured' }, ...channelList];
        showAddDialog = false;
        newName = '';
        await goto(configurePath(created.kind, created.id));
      }
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head>
  <title>Channels</title>
</svelte:head>

<PageHeader title="CHANNELS" />

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="flex justify-between items-center mb-8">
    <div>
      <p class="text-sm" style="color: var(--text-secondary);">
        Site-level messaging channels — WhatsApp, Email, and more.
      </p>
    </div>
    <div class="flex items-center gap-3">
      <button
        onclick={() => { showAddDialog = true; }}
        class="px-4 py-2 rounded-[var(--radius-round)] text-sm font-medium transition-colors"
        style="background: var(--accent); color: white;"
      >
        Add channel
      </button>
    </div>
  </div>

  {#if channelList.length === 0}
    <div
      class="text-center py-16 rounded-[var(--radius-round)] border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p class="text-lg mb-2" style="color: var(--text-secondary);">No channels yet</p>
      <p class="text-sm" style="color: var(--text-ghost);">Add your first channel to get started.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each channelList as ch}
        <div
          class="group relative p-5 rounded-[var(--radius-round)] border transition-colors hover:border-[var(--accent)]"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <a href={configurePath(ch.kind, ch.id)} class="absolute inset-0 z-0" aria-label="Configure channel"></a>

          <div class="flex items-start justify-between mb-2">
            <div class="flex items-center gap-2">
              <span
                class="w-2.5 h-2.5 rounded-full"
                style="background: {STATUS_COLORS[ch.status] ?? 'var(--text-ghost)'};"
                title={ch.status}
              ></span>
              <h2
                class="text-base font-medium group-hover:text-[var(--accent)] transition-colors"
                style="color: var(--text-primary);"
              >
                {ch.name}
              </h2>
            </div>
            <div class="flex items-center gap-2 shrink-0 relative z-10">
              <label class="inline-flex items-center gap-1.5 text-[11px]" style="color: var(--text-ghost);">
                <input
                  type="checkbox"
                  checked={ch.enabled}
                  onchange={(e) => toggleEnabled(ch, (e.currentTarget as HTMLInputElement).checked)}
                />
                Enabled
              </label>
              <button
                onclick={(e) => deleteChannel(ch.id, e)}
                class="px-2.5 py-1 rounded-[var(--radius-round)] border opacity-0 group-hover:opacity-100 transition-all text-xs font-medium"
                style="color: var(--error); border-color: var(--error); background: var(--error-bg);"
                title="Delete channel"
              >
                Delete
              </button>
            </div>
          </div>

          <div class="flex items-center gap-3 mt-2 flex-wrap">
            <span
              class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border"
              style="color: var(--text-ghost); border-color: var(--card-border); font-family: var(--font-mono);"
            >
              {KIND_LABELS[ch.kind] ?? ch.kind}
            </span>
            <span
              class="text-[11px]"
              style="color: {STATUS_COLORS[ch.status] ?? 'var(--text-ghost)'}; font-family: var(--font-mono);"
            >
              {ch.status}
            </span>
          </div>

          <div class="mt-3 relative z-10">
            <a
              href={configurePath(ch.kind, ch.id)}
              class="text-xs font-medium"
              style="color: var(--accent);"
            >
              Configure →
            </a>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if showAddDialog}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    style="background: rgba(0, 0, 0, 0.5);"
    onclick={(e) => { if (e.target === e.currentTarget) showAddDialog = false; }}
    role="presentation"
  >
    <div
      class="w-full max-w-md rounded-[var(--radius-round)] border p-6 shadow-xl"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <h2 class="text-lg font-medium mb-4" style="color: var(--text-primary);">Add channel</h2>

      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Kind
      </label>
      <select
        bind:value={newKind}
        class="w-full mb-3 px-2 py-1.5 rounded text-sm border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
      >
        <option value="email">Email</option>
        <option value="whatsapp">WhatsApp</option>
      </select>

      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Name
      </label>
      <input
        type="text"
        bind:value={newName}
        placeholder="e.g. Personal Email"
        class="w-full mb-4 px-2 py-1.5 rounded text-sm border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
      />

      <div class="flex justify-end gap-2">
        <button
          onclick={() => { showAddDialog = false; }}
          class="px-3 py-1.5 rounded text-sm border"
          style="border-color: var(--card-border); color: var(--text-secondary); background: transparent;"
        >
          Cancel
        </button>
        <button
          onclick={createChannel}
          disabled={creating || !newName.trim()}
          class="px-3 py-1.5 rounded text-sm font-medium"
          style="background: var(--accent); color: white; opacity: {creating || !newName.trim() ? 0.6 : 1};"
        >
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}
