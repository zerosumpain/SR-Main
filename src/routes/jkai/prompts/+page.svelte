<script lang="ts">
  import { onMount } from 'svelte';

  interface PromptFile {
    name: string;
    content: string;
    size: number;
    lastModified: string;
  }

  let files: PromptFile[] = $state([]);
  let selectedFile: string | null = $state(null);
  let editContent: string = $state('');
  let saving = $state(false);
  let syncing = $state(false);
  let saveMessage: string = $state('');
  let loading = $state(true);

  let selectedFileData = $derived(files.find((f) => f.name === selectedFile));

  async function loadFiles() {
    loading = true;
    try {
      const res = await fetch('/api/workflows/prompts');
      if (!res.ok) return;
      const data = await res.json();
      files = data.files || [];
      if (files.length > 0 && !selectedFile) {
        selectFile(files[0].name);
      }
    } finally {
      loading = false;
    }
  }

  function selectFile(name: string) {
    selectedFile = name;
    const file = files.find((f) => f.name === name);
    editContent = file?.content || '';
    saveMessage = '';
  }

  async function saveFile() {
    if (!selectedFile) return;
    saving = true;
    saveMessage = '';
    try {
      const res = await fetch(`/api/workflows/prompts/${selectedFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        saveMessage = 'Saved and synced';
        await loadFiles();
        // Re-select to update content
        if (selectedFile) {
          const updated = files.find((f) => f.name === selectedFile);
          if (updated) editContent = updated.content;
        }
      } else {
        saveMessage = 'Save failed';
      }
    } finally {
      saving = false;
      setTimeout(() => { saveMessage = ''; }, 3000);
    }
  }

  async function forceSync() {
    syncing = true;
    try {
      await fetch('/api/workflows/prompts', { method: 'POST' });
      saveMessage = 'Synced from disk';
      await loadFiles();
    } finally {
      syncing = false;
      setTimeout(() => { saveMessage = ''; }, 3000);
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  onMount(loadFiles);
</script>

<svelte:head>
  <title>System Prompts</title>
</svelte:head>

<div class="p-6 sm:p-10 max-w-6xl mx-auto">
  <div class="flex justify-between items-center mb-6">
    <div>
      <div class="flex items-center gap-3">
        <a href="/jkai" class="back-link">Chat</a>
      </div>
      <h1 class="display text-[28px] sm:text-[36px] mt-1" style="color: var(--text-primary);">
        SYSTEM PROMPTS
      </h1>
      <p class="text-sm mt-1" style="color: var(--text-secondary);">
        Prompt files that shape the AI's personality and behaviour across WhatsApp and the website.
      </p>
    </div>
    <button
      onclick={forceSync}
      disabled={syncing}
      class="px-4 py-2 rounded-lg text-sm font-medium transition-colors border"
      style="border-color: var(--card-border); color: var(--text-secondary); opacity: {syncing ? 0.7 : 1};"
    >
      {syncing ? 'Syncing...' : 'Sync from Disk'}
    </button>
  </div>

  {#if loading}
    <div class="text-center py-16">
      <p class="text-sm animate-pulse" style="color: var(--text-ghost);">Loading prompt files...</p>
    </div>
  {:else}
    <div class="flex gap-6" style="min-height: 70vh;">
      <!-- File List -->
      <div class="w-56 flex-shrink-0 space-y-1">
        {#each files as file}
          <button
            onclick={() => selectFile(file.name)}
            class="w-full text-left px-3 py-2.5 rounded-lg transition-colors border"
            style="background: {selectedFile === file.name ? 'var(--accent)' : 'var(--card-bg)'}; border-color: {selectedFile === file.name ? 'var(--accent)' : 'var(--card-border)'}; color: {selectedFile === file.name ? 'white' : 'var(--text-primary)'};"
          >
            <div class="text-xs font-medium" style="font-family: var(--font-mono);">
              {file.name}
            </div>
            <div class="text-[10px] mt-0.5" style="color: {selectedFile === file.name ? 'rgba(255,255,255,0.7)' : 'var(--text-ghost)'};">
              {file.size} bytes · {formatDate(file.lastModified)}
            </div>
          </button>
        {/each}
      </div>

      <!-- Editor -->
      <div class="flex-1 flex flex-col">
        {#if selectedFile}
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-medium" style="color: var(--text-primary); font-family: var(--font-mono);">
              {selectedFile}
            </h2>
            <div class="flex items-center gap-3">
              {#if saveMessage}
                <span class="text-xs" style="color: #22c55e;">{saveMessage}</span>
              {/if}
              <button
                onclick={saveFile}
                disabled={saving}
                class="px-4 py-1.5 rounded text-sm font-medium transition-colors"
                style="background: var(--accent); color: white; opacity: {saving ? 0.7 : 1};"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          <textarea
            bind:value={editContent}
            class="flex-1 w-full px-4 py-3 rounded-lg border resize-none text-sm leading-relaxed"
            style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 500px;"
            spellcheck="false"
          ></textarea>
        {:else}
          <div class="flex-1 flex items-center justify-center">
            <p class="text-sm" style="color: var(--text-ghost);">Select a prompt file to edit</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
