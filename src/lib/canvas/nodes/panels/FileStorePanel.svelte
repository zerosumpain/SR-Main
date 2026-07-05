<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // Operations supported by the file-store executor. Each is mapped to
  // a one-line description shown in the meta line on the operation header.
  type Operation = 'read' | 'write' | 'append' | 'delete' | 'list';

  const operation = $derived<Operation>(((config.operation as Operation) || 'read'));
  const encoding = $derived(String(config.encoding ?? 'utf8'));

  // Conditional reveal logic:
  //   fileName    → required for read / write / append / delete (NOT list).
  //   encoding    → relevant for read / write / append.
  //   contentPath → only for write / append (selects content from input).
  //   prefix      → only for list (name-prefix filter).
  const needsFileName = $derived(operation !== 'list');
  const needsEncoding = $derived(operation === 'read' || operation === 'write' || operation === 'append');
  const needsContentPath = $derived(operation === 'write' || operation === 'append');
  const isList = $derived(operation === 'list');

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // Operation summary for the section header.
  const opSummary = $derived(
    operation === 'read' ? 'Load file content from the store'
    : operation === 'write' ? 'Overwrite or create a file'
    : operation === 'append' ? 'Append to an existing file'
    : operation === 'delete' ? 'Remove a file from the store'
    : 'Enumerate files (optionally filtered by prefix)'
  );

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header handles the "What this does" line so we don't duplicate it here.
  void definition;

  // ---------- Browse the file store ---------------------------------------
  // Fetches /api/files once per panel mount and lets the user pick a file
  // from a real list rather than typing the name from memory. Optional —
  // they can still type a templated name (e.g. `reports/{{input.date}}.csv`)
  // for dynamic destinations.
  interface FileEntry { id: number; name: string; mimeType: string; sizeBytes: number; description?: string | null }
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
    set('fileName', name);
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
</script>

<div class="fs">
  <!-- Operation toggle -->
  <section class="fs-sec">
    <header class="fs-sec-hdr">
      <span class="sr-label-tight">Operation</span>
      <span class="fs-sec-meta">{opSummary}</span>
    </header>
    <div class="fs-pills" role="tablist" aria-label="File operation">
      {#each [
        { v: 'read', label: 'Read' },
        { v: 'write', label: 'Write' },
        { v: 'append', label: 'Append' },
        { v: 'delete', label: 'Delete' },
        { v: 'list', label: 'List' },
      ] as opt (opt.v)}
        <button
          type="button"
          role="tab"
          aria-selected={operation === opt.v}
          class="fs-pill"
          class:fs-pill-active={operation === opt.v}
          onclick={() => set('operation', opt.v)}
        >{opt.label}</button>
      {/each}
    </div>
  </section>

  <!-- File name (read / write / append / delete) -->
  {#if needsFileName}
    <section class="fs-sec">
      <header class="fs-sec-hdr">
        <span class="sr-label-tight">File name</span>
        <button type="button" class="fs-browse-btn" onclick={togglePicker}>
          {pickerOpen ? 'Hide browser' : 'Browse files…'}
        </button>
      </header>
      <label class="fs-field">
        <input
          type="text"
          spellcheck="false"
          placeholder="reports/daily.csv"
          value={String(config.fileName ?? '')}
          oninput={(e) => set('fileName', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="fs-hint">Type a name (templates supported: <code>{`{{input.field}}`}</code>) or click Browse to pick from the file store.</span>
      </label>
      {#if pickerOpen}
        <div class="fs-picker">
          <input
            type="text"
            class="fs-picker-search"
            placeholder="Filter by name…"
            value={pickerQuery}
            oninput={(e) => { pickerQuery = (e.currentTarget as HTMLInputElement).value; }}
          />
          {#if filesLoading}
            <p class="fs-picker-empty">Loading…</p>
          {:else if fileError}
            <p class="fs-picker-empty fs-picker-err">Couldn't load file list: {fileError}. <a href="/drive" target="_blank" rel="noopener">Open /drive →</a></p>
          {:else if !fileList || fileList.length === 0}
            <p class="fs-picker-empty">No files in store yet. <a href="/drive" target="_blank" rel="noopener">Upload one →</a></p>
          {:else if filteredFiles.length === 0}
            <p class="fs-picker-empty">No files match "{pickerQuery}".</p>
          {:else}
            <ul class="fs-picker-list" role="listbox">
              {#each filteredFiles as f (f.id)}
                <li>
                  <button
                    type="button"
                    class="fs-picker-row"
                    class:fs-picker-row-active={String(config.fileName ?? '') === f.name}
                    onclick={() => pickFile(f.name)}
                  >
                    <span class="fs-picker-name">{f.name}</span>
                    <span class="fs-picker-meta">{f.mimeType} · {fmtSize(f.sizeBytes)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  <!-- Prefix filter (list only) -->
  {#if isList}
    <section class="fs-sec">
      <header class="fs-sec-hdr">
        <span class="sr-label-tight">Name prefix filter</span>
      </header>
      <label class="fs-field">
        <input
          type="text"
          spellcheck="false"
          placeholder="reports/"
          value={String(config.prefix ?? '')}
          oninput={(e) => set('prefix', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="fs-hint">Leave empty to list every file in the store.</span>
      </label>
    </section>
  {/if}

  <!-- Encoding (read / write / append) -->
  {#if needsEncoding}
    <section class="fs-sec">
      <header class="fs-sec-hdr">
        <span class="sr-label-tight">Encoding</span>
      </header>
      <label class="fs-field">
        <select value={encoding} onchange={(e) => set('encoding', (e.currentTarget as HTMLSelectElement).value)}>
          <option value="utf8">utf8 (text)</option>
          <option value="base64">base64 (binary)</option>
        </select>
        <span class="fs-hint">Use <code>base64</code> for images / PDFs / other binary content.</span>
      </label>
    </section>
  {/if}

  <!-- Content path (write / append) -->
  {#if needsContentPath}
    <section class="fs-sec">
      <header class="fs-sec-hdr">
        <span class="sr-label-tight">Content path</span>
        <span class="fs-sec-meta">optional</span>
      </header>
      <label class="fs-field">
        <input
          type="text"
          spellcheck="false"
          placeholder="data.body"
          value={String(config.contentPath ?? '')}
          oninput={(e) => set('contentPath', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="fs-hint">
          Dot-path into <code>input</code> to extract content. Defaults to
          <code>input.content</code>, then the whole input as JSON / string.
        </span>
      </label>
    </section>
  {/if}

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="fs-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="fs-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* invalid — keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .fs { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .fs-sec { display: flex; flex-direction: column; gap: 8px; }
  .fs-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .fs-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .fs-pills {
    display: flex; gap: 4px; flex-wrap: wrap;
  }
  .fs-pill {
    flex: 1 1 0;
    min-width: 64px;
    padding: 6px 10px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
    outline: none;
  }
  .fs-pill:hover { color: var(--text-primary); }
  .fs-pill-active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    border-color: var(--accent);
  }

  .fs-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .fs-hint { font-size: 11px; color: var(--text-ghost); }
  .fs-hint code { font-size: 11px; color: var(--text-muted); }

  .fs-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .fs-code:focus { border-color: var(--text-muted); }

  input[type='text'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .fs-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .fs-raw summary { cursor: pointer; }

  .fs-browse-btn {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px dashed var(--card-border);
    padding: 3px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .fs-browse-btn:hover { color: var(--text-primary); }
  .fs-picker {
    margin-top: 6px;
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 3%, transparent);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fs-picker-search { font-family: var(--font-mono); font-size: 11px; }
  .fs-picker-empty {
    margin: 0;
    padding: 6px 4px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .fs-picker-empty.fs-picker-err { color: var(--status-error, #c0392b); }
  .fs-picker-empty a { color: var(--accent); }
  .fs-picker-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 280px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .fs-picker-row {
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
  .fs-picker-row:hover { border-color: var(--text-muted); }
  .fs-picker-row-active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .fs-picker-name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    word-break: break-all;
  }
  .fs-picker-meta {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
</style>
