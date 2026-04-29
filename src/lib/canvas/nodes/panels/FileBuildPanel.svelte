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

  // Config keys read by the executor (see src/lib/workflows/nodes/file-build.ts):
  //   format       — 'docx' | 'pdf' | 'html' | 'xlsx' | 'csv'   (required)
  //   source       — 'markdown' | 'text' | 'json' | 'csv' | 'xlsx' (required)
  //   contentPath  — dot-path into input. Default 'input.content'.
  //   title        — optional title (docx/pdf only).
  //   persist      — boolean. When true, output is also saved to file store.
  //   outputName   — required when persist=true. Templates supported.
  //   _onError     — universal on-failure block.

  const FORMATS: Array<{ value: string; label: string }> = [
    { value: 'docx', label: 'DOCX (Word)' },
    { value: 'pdf', label: 'PDF' },
    { value: 'html', label: 'HTML' },
    { value: 'xlsx', label: 'XLSX (Excel)' },
    { value: 'csv', label: 'CSV' },
  ];
  const SOURCES: Array<{ value: string; label: string }> = [
    { value: 'markdown', label: 'Markdown' },
    { value: 'text', label: 'Plain text' },
    { value: 'json', label: 'JSON (array of rows)' },
    { value: 'csv', label: 'CSV' },
    { value: 'xlsx', label: 'XLSX (binary, base64)' },
  ];

  const format = $derived(String(config.format ?? ''));
  const source = $derived(String(config.source ?? ''));
  const contentPath = $derived(String(config.contentPath ?? ''));
  const title = $derived(String(config.title ?? ''));
  const persist = $derived(Boolean(config.persist));
  const outputName = $derived(String(config.outputName ?? ''));

  // Title is only meaningful for docx / pdf — match the executor / synthesise.
  const titleApplies = $derived(format === 'docx' || format === 'pdf');

  // Warn if persist=true but outputName is empty — the executor will throw
  // at runtime, so surface it in the editor.
  const persistNeedsName = $derived(persist && !outputName.trim());

  // Light hint when the user picks a source/format combo that's likely a
  // mistake. We don't block — synthesize() is the real authority — but a
  // gentle nudge helps. (e.g. xlsx-source only makes sense for xlsx output.)
  const xlsxMismatch = $derived(source === 'xlsx' && format !== 'xlsx');

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level page
  // already renders the "What this does" preview header.
  void definition;
</script>

<div class="fb">
  <!-- Output / input format -->
  <section class="fb-sec">
    <header class="fb-sec-hdr"><span class="sr-label-tight">Format</span></header>
    <div class="fb-row">
      <label class="fb-field">
        <span class="fb-label">Output format</span>
        <select value={format} onchange={(e) => set('format', (e.currentTarget as HTMLSelectElement).value)}>
          <option value="" disabled>— pick one —</option>
          {#each FORMATS as f}
            <option value={f.value}>{f.label}</option>
          {/each}
        </select>
      </label>
      <label class="fb-field">
        <span class="fb-label">Input format (source)</span>
        <select value={source} onchange={(e) => set('source', (e.currentTarget as HTMLSelectElement).value)}>
          <option value="" disabled>— pick one —</option>
          {#each SOURCES as s}
            <option value={s.value}>{s.label}</option>
          {/each}
        </select>
      </label>
    </div>
    {#if xlsxMismatch}
      <p class="fb-warn-line">XLSX source is normally paired with XLSX output — other combinations may fail at runtime.</p>
    {/if}
  </section>

  <!-- Content path + title -->
  <section class="fb-sec">
    <header class="fb-sec-hdr"><span class="sr-label-tight">Content</span></header>
    <label class="fb-field">
      <span class="fb-label">Content path</span>
      <input
        type="text"
        spellcheck="false"
        placeholder="input.content"
        value={contentPath}
        oninput={(e) => set('contentPath', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="fb-hint">Dot-path into the upstream input. Defaults to <code>input.content</code> when blank.</span>
    </label>

    <label class="fb-field" class:fb-field-disabled={!titleApplies}>
      <span class="fb-label">Title {#if !titleApplies}<span class="fb-meta">(docx/pdf only)</span>{/if}</span>
      <input
        type="text"
        spellcheck="false"
        placeholder="Weekly summary"
        value={title}
        oninput={(e) => set('title', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="fb-hint">Optional — used as the document title for DOCX/PDF output.</span>
    </label>
  </section>

  <!-- Persistence -->
  <section class="fb-sec">
    <header class="fb-sec-hdr">
      <span class="sr-label-tight">Save to file store</span>
      {#if persist}<span class="fb-meta-on">on</span>{:else}<span class="fb-meta">off</span>{/if}
    </header>
    <label class="fb-toggle">
      <input
        type="checkbox"
        checked={persist}
        onchange={(e) => set('persist', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Persist the output as a workflow file (in addition to returning base64).</span>
    </label>

    {#if persist}
      <label class="fb-field">
        <span class="fb-label">Saved file name</span>
        <input
          type="text"
          spellcheck="false"
          placeholder={'reports/{{input.id}}.docx'}
          value={outputName}
          oninput={(e) => set('outputName', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="fb-hint">
          Required when persist is on. Templates supported: <code>{`{{input.field}}`}</code>.
          Existing files with the same name are overwritten.
        </span>
        {#if persistNeedsName}
          <span class="fb-warn">Required — executor will throw without a name.</span>
        {/if}
      </label>
    {/if}
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="fb-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="fb-code"
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
  .fb { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .fb-sec { display: flex; flex-direction: column; gap: 8px; }
  .fb-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .fb-row { display: flex; gap: 10px; }
  .fb-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .fb-field-disabled { opacity: 0.55; }

  .fb-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .fb-hint { font-size: 11px; color: var(--text-ghost); }
  .fb-hint code, .fb-label code { font-size: 11px; color: var(--text-muted); }

  .fb-meta {
    font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .fb-meta-on {
    font-family: var(--font-mono); font-size: 10px; color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.06em;
  }

  .fb-toggle {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: var(--text-primary);
    cursor: pointer;
  }
  .fb-toggle input { width: auto; margin: 0; }

  .fb-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
  }
  .fb-warn-line {
    margin: 0;
    font-size: 11px;
    color: var(--status-warning, #b07a1a);
  }

  .fb-code {
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
  .fb-code:focus { border-color: var(--text-muted); }

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

  .fb-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .fb-raw summary { cursor: pointer; }
</style>
