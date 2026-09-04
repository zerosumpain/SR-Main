<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import FilePicker from './shared/FilePicker.svelte';

  // Panel for the `file-write` workflow node. The executor lives in
  // `src/lib/workflows/nodes/file-ops.ts` (see `fileWriteExecutor`) and reads:
  //   fileName    – name in the workflow file store, supports {{input.field}}
  //   append      – when true: append to existing file (must exist); else
  //                 overwrite-or-create
  //   encoding    – 'utf8' (text) | 'base64' (binary)
  //   contentPath – dot-path into the input object. If unset, the executor
  //                 falls back to `input.content`, then the whole input.
  //
  // Content itself is NEVER stored on the node — it always comes from the
  // upstream input. The "Content source" textarea below sets the dot-path
  // (`contentPath`) so users can point at e.g. `data.body` or `result.text`.

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // ---------- derived state ----------------------------------------------

  const fileName = $derived(String(config.fileName ?? ''));
  const append = $derived(!!config.append);
  const encoding = $derived(String(config.encoding ?? 'utf8'));
  const contentPath = $derived(String(config.contentPath ?? ''));
  const mode = $derived<'overwrite' | 'append'>(append ? 'append' : 'overwrite');

  function set(key: string, value: unknown) {
    // Spread first so unknown keys (e.g. `_onError`, future fields) survive.
    onChange({ ...config, [key]: value });
  }

  function setMode(m: 'overwrite' | 'append') {
    onChange({ ...config, append: m === 'append' });
  }
  // `definition` is referenced only for typings; the canvas-level preview
  // header renders the "What this does" line so we don't duplicate it here.
  void definition;
</script>

<div class="fw">
  <!-- File name (path) -->
  <section class="fw-sec">
    <header class="fw-sec-hdr">
      <span class="sr-label-tight">File name</span>
      <span class="fw-sec-meta">required · {mode === 'append' ? 'must exist' : 'will create or overwrite'}</span>
    </header>
    <div class="fw-field">
      <FilePicker
        value={fileName}
        mode={mode === 'append' ? 'read' : 'write'}
        placeholder={'logs/{{input.id}}.txt'}
        onChange={(v) => set('fileName', v)}
        hint={mode === 'append'
          ? 'Pick the existing file to append to, or type a templated name. Templates supported: {{input.field}}.'
          : 'Pick an existing file to overwrite, or type a new path to create. Templates supported: {{input.field}}.'}
      />
    </div>
  </section>

  <!-- Write mode -->
  <section class="fw-sec">
    <header class="fw-sec-hdr">
      <span class="sr-label-tight">Mode</span>
      <span class="fw-sec-meta">{
        mode === 'append'
          ? 'Append to an existing file'
          : 'Overwrite or create the file'
      }</span>
    </header>
    <label class="fw-field">
      <select value={mode} onchange={(e) => setMode((e.currentTarget as HTMLSelectElement).value as 'overwrite' | 'append')}>
        <option value="overwrite">Overwrite or create (default)</option>
        <option value="append">Append (file must already exist)</option>
      </select>
      <span class="fw-hint">
        {#if mode === 'append'}
          Appends bytes to the end of the file. Fails if the file doesn&apos;t
          exist or lacks <code>append</code> permission.
        {:else}
          Replaces the file&apos;s contents, or creates it if it doesn&apos;t
          exist (with <code>read/write/append</code> permissions).
        {/if}
      </span>
    </label>
  </section>

  <!-- Encoding -->
  <section class="fw-sec">
    <header class="fw-sec-hdr">
      <span class="sr-label-tight">Encoding</span>
    </header>
    <label class="fw-field">
      <select value={encoding} onchange={(e) => set('encoding', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="utf8">utf8 (text)</option>
        <option value="base64">base64 (binary)</option>
      </select>
      <span class="fw-hint">
        Use <code>base64</code> for images, PDFs, or other binary content where
        the upstream node delivers a base64-encoded string.
      </span>
    </label>
  </section>

  <!-- Content source (contentPath) -->
  <section class="fw-sec">
    <header class="fw-sec-hdr">
      <span class="sr-label-tight">Content</span>
      <span class="fw-sec-meta">from upstream input</span>
    </header>
    <label class="fw-field">
      <span class="fw-label">Source path (dot-path into input)</span>
      <textarea
        class="fw-code"
        rows="2"
        spellcheck="false"
        placeholder={'data.body'}
        value={contentPath}
        oninput={(e) => set('contentPath', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="fw-hint">
        Optional. Dot-path into the upstream input object — for example
        <code>result.text</code> or <code>payload</code>. If empty, the executor
        falls back to <code>input.content</code>, then the whole input
        (stringified as JSON if it&apos;s an object).
      </span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <RawConfigEditor {config} {onChange} />
</div>

<style>
  .fw { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .fw-sec { display: flex; flex-direction: column; gap: 8px; }
  .fw-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .fw-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .fw-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .fw-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .fw-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .fw-hint code { font-size: var(--fs-label); color: var(--text-muted); }

  .fw-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-code); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .fw-code:focus { border-color: var(--text-muted); }

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
</style>
