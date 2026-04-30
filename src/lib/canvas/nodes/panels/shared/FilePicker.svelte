<script lang="ts">
  // Shared file-store picker. Lifts the inline pattern from
  // FileStorePanel.svelte so every File* panel can reuse the same UX:
  //   - free-text input (templates supported)
  //   - "Browse files…" button toggles a search + list of /api/files entries
  //   - clicking a row sets the value
  //   - existing-only (read mode) vs free-text-or-existing (write mode) — the
  //     picker doesn't actually enforce existence (mirrors how StoreKeyPicker
  //     `set` works) but emphasises the "+ New file" affordance in write mode.
  //
  // Templated values (`{{...}}`) are kept as free-text — no validation.

  interface FileEntry {
    id: number;
    name: string;
    mimeType: string;
    sizeBytes: number;
    description?: string | null;
  }

  let {
    value,
    onChange,
    mode = 'read',
    placeholder = 'reports/daily.csv',
    hint,
  }: {
    value: string;
    onChange: (next: string) => void;
    /**
     * 'read'  — picker for an existing file (read / delete / extract).
     *           Shows "Browse files…" + free-text input. New names are
     *           still typeable (matches FileStorePanel behaviour) but the
     *           hint nudges towards picking one.
     * 'write' — picker for a destination file (write / build output). New
     *           names are first-class — the hint mentions "create new" and
     *           the button labels reflect that.
     */
    mode?: 'read' | 'write';
    placeholder?: string;
    /** Optional override hint text below the input. */
    hint?: string;
  } = $props();

  let fileList = $state<FileEntry[] | null>(null);
  let fileError = $state<string | null>(null);
  let filesLoading = $state(false);
  let pickerQuery = $state('');
  let pickerOpen = $state(false);

  async function loadFiles() {
    if (filesLoading || fileList !== null) return;
    filesLoading = true;
    try {
      const res = await fetch('/api/files');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      fileList = (body.files ?? []) as FileEntry[];
    } catch (err) {
      fileError = err instanceof Error ? err.message : String(err);
    } finally {
      filesLoading = false;
    }
  }

  function togglePicker() {
    pickerOpen = !pickerOpen;
    if (pickerOpen) loadFiles();
  }
  function pickFile(name: string) {
    onChange(name);
    pickerOpen = false;
  }

  const filteredFiles = $derived.by(() => {
    if (!fileList) return [];
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return fileList;
    return fileList.filter((f) => f.name.toLowerCase().includes(q));
  });

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  const defaultHint = $derived(
    mode === 'write'
      ? 'Type a new name to create the file, or click Browse to overwrite an existing one. Templates supported: {{input.field}}.'
      : 'Type a name (templates supported: {{input.field}}) or click Browse to pick from the file store.',
  );
  const browseLabel = $derived(pickerOpen ? 'Hide browser' : 'Browse files…');
</script>

<div class="fp">
  <div class="fp-row">
    <input
      type="text"
      class="fp-input"
      spellcheck="false"
      placeholder={placeholder}
      {value}
      oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
    />
    <button type="button" class="fp-browse-btn" onclick={togglePicker}>
      {browseLabel}
    </button>
  </div>
  <span class="fp-hint">{hint ?? defaultHint}</span>

  {#if pickerOpen}
    <div class="fp-picker">
      <input
        type="text"
        class="fp-picker-search"
        placeholder="Filter by name…"
        value={pickerQuery}
        oninput={(e) => { pickerQuery = (e.currentTarget as HTMLInputElement).value; }}
      />
      {#if filesLoading}
        <p class="fp-picker-empty">Loading…</p>
      {:else if fileError}
        <p class="fp-picker-empty fp-picker-err">
          Couldn't load file list: {fileError}.
          <a href="/admin/files" target="_blank" rel="noopener">Open /admin/files →</a>
        </p>
      {:else if !fileList || fileList.length === 0}
        <p class="fp-picker-empty">
          No files in store yet.
          <a href="/admin/files" target="_blank" rel="noopener">Upload one →</a>
        </p>
      {:else if filteredFiles.length === 0}
        <p class="fp-picker-empty">No files match "{pickerQuery}".</p>
      {:else}
        <ul class="fp-picker-list" role="listbox">
          {#each filteredFiles as f (f.id)}
            <li>
              <button
                type="button"
                class="fp-picker-row"
                class:fp-picker-row-active={value === f.name}
                onclick={() => pickFile(f.name)}
              >
                <span class="fp-picker-name">{f.name}</span>
                <span class="fp-picker-meta">{f.mimeType} · {fmtSize(f.sizeBytes)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .fp { display: flex; flex-direction: column; gap: 4px; }

  .fp-row { display: flex; gap: 6px; align-items: stretch; }
  .fp-input {
    flex: 1;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  .fp-input:focus { border-color: var(--text-muted); }

  .fp-browse-btn {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px dashed var(--card-border);
    padding: 3px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
    white-space: nowrap;
  }
  .fp-browse-btn:hover { color: var(--text-primary); }

  .fp-hint { font-size: 11px; color: var(--text-ghost); }

  .fp-picker {
    margin-top: 6px;
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 3%, transparent);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fp-picker-search {
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: 11px;
    box-sizing: border-box;
    outline: none;
  }
  .fp-picker-search:focus { border-color: var(--text-muted); }
  .fp-picker-empty {
    margin: 0;
    padding: 6px 4px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .fp-picker-empty.fp-picker-err { color: var(--status-error, #c0392b); }
  .fp-picker-empty a { color: var(--accent); }
  .fp-picker-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 280px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .fp-picker-row {
    width: 100%;
    text-align: left;
    background: var(--bg);
    border: 1px solid var(--card-border);
    padding: 6px 8px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text-primary);
  }
  .fp-picker-row:hover { border-color: var(--text-muted); }
  .fp-picker-row-active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .fp-picker-name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    word-break: break-all;
  }
  .fp-picker-meta {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
</style>
