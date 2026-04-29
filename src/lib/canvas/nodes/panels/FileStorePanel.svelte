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
      </header>
      <label class="fs-field">
        <input
          type="text"
          spellcheck="false"
          placeholder="reports/daily.csv"
          value={String(config.fileName ?? '')}
          oninput={(e) => set('fileName', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="fs-hint">Templates supported: <code>{`{{input.field}}`}</code></span>
      </label>
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
</style>
