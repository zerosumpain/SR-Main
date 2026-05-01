<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  interface PromptFile {
    name: string;
    content: string;
    size: number;
    lastModified: string;
  }

  let files: PromptFile[] = $state([]);
  let selectedFile: string | null = $state(null);
  let editContent: string = $state('');
  let savedContent: string = $state('');
  let saving = $state(false);
  let syncing = $state(false);
  let saveStatus: { kind: 'idle' | 'ok' | 'error'; text: string } = $state({ kind: 'idle', text: '' });
  let loading = $state(true);

  let dirty = $derived(editContent !== savedContent);
  let selectedFileData = $derived(files.find((f) => f.name === selectedFile));

  async function loadFiles() {
    loading = true;
    try {
      const res = await fetch('/api/workflows/prompts');
      if (!res.ok) {
        saveStatus = { kind: 'error', text: `Couldn't load files (${res.status})` };
        return;
      }
      const data = await res.json();
      files = data.files || [];
      if (files.length > 0 && !selectedFile) {
        selectFile(files[0].name);
      }
    } catch (e) {
      saveStatus = { kind: 'error', text: e instanceof Error ? e.message : 'Network error loading files' };
    } finally {
      loading = false;
    }
  }

  function selectFile(name: string) {
    if (dirty && !confirm('You have unsaved changes. Discard and switch files?')) return;
    selectedFile = name;
    const file = files.find((f) => f.name === name);
    editContent = file?.content ?? '';
    savedContent = file?.content ?? '';
    saveStatus = { kind: 'idle', text: '' };
  }

  async function saveFile() {
    if (!selectedFile || saving || !dirty) return;
    const fileBeingSaved = selectedFile;
    const contentBeingSaved = editContent;
    saving = true;
    saveStatus = { kind: 'idle', text: 'Saving…' };
    try {
      const res = await fetch(`/api/workflows/prompts/${fileBeingSaved}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentBeingSaved }),
      });
      if (!res.ok) {
        let detail = `${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) detail = `${res.status}: ${body.error}`;
        } catch {}
        saveStatus = { kind: 'error', text: `Save failed (${detail})` };
        return;
      }
      // Mark this exact content as the persisted baseline. Do NOT touch
      // editContent — the user may have typed more characters while the
      // request was in flight; clobbering would lose those keystrokes.
      if (selectedFile === fileBeingSaved) {
        savedContent = contentBeingSaved;
      }
      saveStatus = { kind: 'ok', text: `Saved at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` };
      // Refresh metadata (size + lastModified) but don't disturb the editor.
      try {
        const res2 = await fetch('/api/workflows/prompts');
        if (res2.ok) {
          const data = await res2.json();
          files = data.files || files;
        }
      } catch { /* metadata refresh is best-effort */ }
    } catch (e) {
      saveStatus = { kind: 'error', text: e instanceof Error ? e.message : 'Network error' };
    } finally {
      saving = false;
    }
  }

  async function forceSync() {
    syncing = true;
    saveStatus = { kind: 'idle', text: 'Syncing…' };
    try {
      const res = await fetch('/api/workflows/prompts', { method: 'POST' });
      if (!res.ok) {
        saveStatus = { kind: 'error', text: `Sync failed (${res.status})` };
        return;
      }
      const data = await res.json();
      files = data.files || [];
      if (selectedFile) {
        const updated = files.find((f) => f.name === selectedFile);
        if (updated && !dirty) {
          editContent = updated.content;
          savedContent = updated.content;
        }
      }
      saveStatus = { kind: 'ok', text: 'Re-synced from disk' };
    } catch (e) {
      saveStatus = { kind: 'error', text: e instanceof Error ? e.message : 'Network error' };
    } finally {
      syncing = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
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

<PageHeader title="SYSTEM PROMPTS" />

<div class="p-6 sm:p-10 max-w-6xl mx-auto">
  <div class="flex justify-between items-center mb-6">
    <div>
      <p class="text-sm" style="color: var(--text-secondary);">
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
          <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 class="text-sm font-medium flex items-center gap-2" style="color: var(--text-primary); font-family: var(--font-mono);">
              {selectedFile}
              {#if dirty}
                <span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent);">
                  unsaved
                </span>
              {/if}
            </h2>
            <div class="flex items-center gap-3">
              {#if saveStatus.text}
                <span
                  class="text-xs"
                  style="color: {saveStatus.kind === 'error' ? '#c44' : saveStatus.kind === 'ok' ? '#22c55e' : 'var(--text-ghost)'};"
                >
                  {saveStatus.text}
                </span>
              {/if}
              <button
                onclick={saveFile}
                disabled={saving || !dirty}
                title={dirty ? 'Save changes (Ctrl/Cmd+S)' : 'Nothing to save'}
                class="px-4 py-1.5 rounded text-sm font-medium transition-colors"
                style="background: var(--accent); color: white; opacity: {saving || !dirty ? 0.5 : 1}; cursor: {saving || !dirty ? 'not-allowed' : 'pointer'};"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          <textarea
            bind:value={editContent}
            onkeydown={handleKeydown}
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
