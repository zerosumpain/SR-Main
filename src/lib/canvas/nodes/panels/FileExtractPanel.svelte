<script lang="ts">
  // FileExtractPanel - structured editor for the legacy multi-mode
  // `file-extract` node (src/lib/workflows/nodes/file-extract.ts). The
  // executor branches on `config.mode`:
  //   mode='extract'    -> reads fileName, pageFrom, pageTo, language, persist, outputName
  //   mode='synthesize' -> reads format, source, contentPath, title, persist, outputName
  //
  // The new canvases should prefer `file-text-extract` (extract) and
  // `file-build` (synthesise) - this panel exists so existing canvases that
  // still pin the legacy node remain editable.
  //
  // The panel also exposes a fields-to-extract table that compiles to a
  // JSON Schema written under `config.extractSchema`. The current executor
  // ignores it, but persisting the schema keeps the canvas-level intent
  // explicit and forwards-compatible with a schema-aware extractor.
  //
  // Unknown keys are preserved via spread. The canvas-level header renders
  // the "What this does" preview, so we don't duplicate it.

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

  void definition;

  // ---------- Model dropdown (kept in sync with LlmCallPanel) -------------

  const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '', label: 'Default (site setting)' },
    { value: 'glm-5-turbo', label: 'GLM 5 Turbo - Z.AI' },
    { value: 'glm-5.1', label: 'GLM 5.1 - Z.AI' },
    { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
    { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
    { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (fast)' },
    { value: 'google/gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
    { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  ];

  const FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'docx', label: 'DOCX (Word)' },
    { value: 'pdf', label: 'PDF' },
    { value: 'html', label: 'HTML' },
    { value: 'xlsx', label: 'XLSX (Excel)' },
    { value: 'csv', label: 'CSV' },
  ];
  const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'markdown', label: 'Markdown' },
    { value: 'text', label: 'Plain text' },
    { value: 'json', label: 'JSON (array of rows)' },
    { value: 'csv', label: 'CSV' },
    { value: 'xlsx', label: 'XLSX (binary, base64)' },
  ];

  // ---------- Fields-to-extract row model ---------------------------------

  type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';
  type FieldRow = { name: string; type: FieldType; description: string };

  const TYPES: FieldType[] = ['string', 'number', 'boolean', 'array', 'object'];

  function readRows(raw: unknown): FieldRow[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => r && typeof r === 'object')
      .map((r) => {
        const o = r as Record<string, unknown>;
        const t = String(o.type ?? 'string') as FieldType;
        return {
          name: String(o.name ?? ''),
          type: TYPES.includes(t) ? t : 'string',
          description: String(o.description ?? ''),
        };
      });
  }

  function buildSchema(rs: FieldRow[]): Record<string, unknown> | undefined {
    const live = rs.filter((r) => r.name.trim());
    if (live.length === 0) return undefined;
    const properties: Record<string, Record<string, unknown>> = {};
    for (const r of live) {
      const prop: Record<string, unknown> = { type: r.type };
      if (r.description.trim()) prop.description = r.description.trim();
      properties[r.name.trim()] = prop;
    }
    return { type: 'object', properties };
  }

  function writeRows(next: FieldRow[]) {
    const schema = buildSchema(next);
    const patched: Record<string, unknown> = { ...config, extractFields: next };
    if (schema) patched.extractSchema = schema;
    else delete patched.extractSchema;
    onChange(patched);
  }

  const rows = $derived(readRows(config.extractFields));

  function addRow() {
    writeRows([...rows, { name: '', type: 'string', description: '' }]);
  }
  function updateRow(i: number, patch: Partial<FieldRow>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    writeRows(next);
  }
  function removeRow(i: number) {
    const next = rows.slice();
    next.splice(i, 1);
    writeRows(next);
  }

  // ---------- Plain field setter -----------------------------------------

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Derived values ---------------------------------------------

  const mode = $derived<'extract' | 'synthesize'>(
    config.mode === 'synthesize' ? 'synthesize' : 'extract'
  );

  // Extract-mode fields
  const fileName = $derived(String(config.fileName ?? ''));
  const pageFrom = $derived(String(config.pageFrom ?? ''));
  const pageTo = $derived(String(config.pageTo ?? ''));
  const language = $derived(String(config.language ?? ''));

  // Synthesise-mode fields
  const format = $derived(String(config.format ?? ''));
  const source = $derived(String(config.source ?? ''));
  const contentPath = $derived(String(config.contentPath ?? ''));
  const title = $derived(String(config.title ?? ''));

  // Shared
  const persist = $derived(toBool(config.persist));
  const outputName = $derived(String(config.outputName ?? ''));

  // Model + temperature (used by downstream LLM extraction step)
  const model = $derived(String(config.model ?? ''));
  const modelInList = $derived(MODEL_OPTIONS.some((o) => o.value === model));
  const temperature = $derived.by(() => {
    const raw = config.temperature;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(2, n));
    return 0.2;
  });
  const tempDescriptor = $derived.by(() => {
    if (temperature <= 0.3) return 'Focused';
    if (temperature <= 1.0) return 'Balanced';
    if (temperature < 1.5) return 'Adventurous';
    return 'Creative';
  });

  function toBool(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v === 'true' || v === '1';
    return false;
  }

  let showRawJson = $state(false);
</script>

<div class="fe">
  <!-- Mode -->
  <section class="fe-sec">
    <header class="fe-sec-hdr">
      <span class="sr-label-tight">Mode</span>
      <span class="fe-sec-meta">legacy node - prefer file-text-extract / file-build for new canvases</span>
    </header>
    <label class="fe-field">
      <span class="fe-label">What should this node do?</span>
      <select value={mode} onchange={(e) => set('mode', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="extract">Extract text from a stored file</option>
        <option value="synthesize">Synthesise a new file from input data</option>
      </select>
    </label>
  </section>

  {#if mode === 'extract'}
    <!-- Extract: source file -->
    <section class="fe-sec">
      <header class="fe-sec-hdr"><span class="sr-label-tight">Source file</span></header>
      <label class="fe-field">
        <span class="fe-label">File name in the workflow file store</span>
        <input
          type="text"
          spellcheck="false"
          placeholder={'docs/contract.pdf or {{input.upload.name}}'}
          value={fileName}
          oninput={(e) => set('fileName', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="fe-hint">
          Required. Templates supported: <code>{`{{input.field}}`}</code>.
          {#if !fileName.trim()}<span class="fe-warn">empty - workflow will fail at runtime</span>{/if}
        </span>
      </label>
    </section>

    <!-- Extract: PDF + audio options -->
    <section class="fe-sec">
      <header class="fe-sec-hdr">
        <span class="sr-label-tight">Format-specific options</span>
        <span class="fe-sec-meta">PDF + audio/video</span>
      </header>
      <div class="fe-row">
        <label class="fe-field fe-field-third">
          <span class="fe-label">First page (PDF)</span>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="1"
            value={pageFrom}
            oninput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              set('pageFrom', v === '' ? undefined : Number(v));
            }}
          />
        </label>
        <label class="fe-field fe-field-third">
          <span class="fe-label">Last page (PDF)</span>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="5"
            value={pageTo}
            oninput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              set('pageTo', v === '' ? undefined : Number(v));
            }}
          />
        </label>
        <label class="fe-field fe-field-third">
          <span class="fe-label">Language (audio/video)</span>
          <input
            type="text"
            placeholder="en"
            value={language}
            oninput={(e) => set('language', (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>
      <span class="fe-hint">
        Pages are 1-indexed and inclusive; leave both empty for the full document.
        Language is a BCP-47 hint passed to Whisper (e.g. <code>en</code>); leave empty for auto-detect.
      </span>
    </section>

    <!-- Extract: fields-to-extract schema builder -->
    <section class="fe-sec">
      <header class="fe-sec-hdr">
        <span class="sr-label-tight">Fields to extract</span>
        <span class="fe-sec-meta">{rows.length} {rows.length === 1 ? 'field' : 'fields'}</span>
      </header>
      {#if rows.length === 0}
        <p class="fe-empty">No structured fields. The node returns plain text only.</p>
      {:else}
        <div class="fe-fld-grid">
          <div class="fe-fld-head">Name</div>
          <div class="fe-fld-head">Type</div>
          <div class="fe-fld-head">Description (sent to model)</div>
          <div></div>
          {#each rows as row, i (i)}
            <input
              type="text"
              class="fe-fld-input"
              placeholder="title"
              value={row.name}
              oninput={(e) => updateRow(i, { name: (e.currentTarget as HTMLInputElement).value })}
            />
            <select
              class="fe-fld-input"
              value={row.type}
              onchange={(e) => updateRow(i, { type: (e.currentTarget as HTMLSelectElement).value as FieldType })}
            >
              {#each TYPES as t (t)}<option value={t}>{t}</option>{/each}
            </select>
            <input
              type="text"
              class="fe-fld-input"
              placeholder="Document title at the top of the page"
              value={row.description}
              oninput={(e) => updateRow(i, { description: (e.currentTarget as HTMLInputElement).value })}
            />
            <button type="button" class="fe-fld-rm" onclick={() => removeRow(i)} aria-label="remove">×</button>
          {/each}
        </div>
      {/if}
      <button type="button" class="fe-add" onclick={addRow}>+ Add field</button>
      <span class="fe-hint">
        A JSON Schema is built from these rows and stored under <code>extractSchema</code>
        for downstream LLM extractors.
      </span>
    </section>

    <!-- Extract: model + temperature -->
    <section class="fe-sec">
      <header class="fe-sec-hdr">
        <span class="sr-label-tight">Model</span>
        <span class="fe-sec-meta">used by downstream LLM extraction</span>
      </header>
      <label class="fe-field">
        <span class="fe-label">Model</span>
        <select value={model} onchange={(e) => set('model', (e.currentTarget as HTMLSelectElement).value)}>
          {#if !modelInList}<option value={model}>Custom: {model}</option>{/if}
          {#each MODEL_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
        <span class="fe-hint">Leave on Default to use the admin-configured site default.</span>
      </label>
      <div class="fe-field">
        <div class="fe-temp-hdr">
          <span class="fe-label">Temperature</span>
          <span class="fe-temp-readout">
            <span class="fe-temp-value">{temperature.toFixed(1)}</span>
            <span class="fe-temp-word">{tempDescriptor}</span>
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={temperature}
          oninput={(e) => set('temperature', Number((e.currentTarget as HTMLInputElement).value))}
          class="fe-range"
        />
        <span class="fe-hint">0 = focused / deterministic - 0.7 = balanced - 1.5+ = creative.</span>
      </div>
    </section>
  {:else}
    <!-- Synthesise: format + source -->
    <section class="fe-sec">
      <header class="fe-sec-hdr"><span class="sr-label-tight">Output and input formats</span></header>
      <div class="fe-row">
        <label class="fe-field">
          <span class="fe-label">Output format</span>
          <select value={format} onchange={(e) => set('format', (e.currentTarget as HTMLSelectElement).value)}>
            <option value="">- choose -</option>
            {#each FORMAT_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>
        <label class="fe-field">
          <span class="fe-label">Input format</span>
          <select value={source} onchange={(e) => set('source', (e.currentTarget as HTMLSelectElement).value)}>
            <option value="">- choose -</option>
            {#each SOURCE_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>
      </div>
      <span class="fe-hint">
        Required. The executor reads the content from <code>contentPath</code> below and
        produces a file in the chosen format.
      </span>
    </section>

    <!-- Synthesise: content path + title -->
    <section class="fe-sec">
      <header class="fe-sec-hdr"><span class="sr-label-tight">Content source</span></header>
      <label class="fe-field">
        <span class="fe-label">Content path</span>
        <input
          type="text"
          placeholder="input.content"
          value={contentPath}
          oninput={(e) => set('contentPath', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="fe-hint">
          Dot-path into the input object. Defaults to <code>input.content</code> when empty.
        </span>
      </label>
      <label class="fe-field">
        <span class="fe-label">Title (optional)</span>
        <input
          type="text"
          placeholder="Quarterly report"
          value={title}
          oninput={(e) => set('title', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="fe-hint">Used for DOCX/PDF document titles.</span>
      </label>
    </section>
  {/if}

  <!-- Persist -->
  <section class="fe-sec">
    <header class="fe-sec-hdr">
      <span class="sr-label-tight">Persist result</span>
    </header>
    <label class="fe-toggle">
      <input
        type="checkbox"
        checked={persist}
        onchange={(e) => set('persist', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>
        {#if mode === 'extract'}
          Save the extracted plain text as a new <code>.txt</code> file in the store
        {:else}
          Save the synthesised file in the store (required to keep the result)
        {/if}
      </span>
    </label>
    {#if persist}
      <label class="fe-field">
        <span class="fe-label">Saved file name</span>
        <input
          type="text"
          spellcheck="false"
          placeholder={mode === 'extract' ? 'extracted/{{input.upload.name}}.txt' : 'reports/{{input.id}}.docx'}
          value={outputName}
          oninput={(e) => set('outputName', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="fe-hint">
          Templates supported.
          {#if mode === 'synthesize'}<span class="fe-warn">required when persist is on</span>{/if}
        </span>
      </label>
    {/if}
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="fe-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced - raw JSON config</span></summary>
    <textarea
      class="fe-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* invalid - keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .fe { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .fe-sec { display: flex; flex-direction: column; gap: 8px; }
  .fe-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .fe-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .fe-row { display: flex; gap: 8px; }
  .fe-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .fe-field-third { flex: 1; }
  .fe-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .fe-hint { font-size: 11px; color: var(--text-ghost); }
  .fe-hint code, .fe-label code { font-size: 11px; color: var(--text-muted); }
  .fe-warn { font-family: var(--font-mono); font-size: 10px; color: var(--status-error, #c0392b); margin-left: 6px; }

  .fe-fld-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 110px minmax(0, 1.6fr) 24px;
    gap: 4px;
    align-items: center;
  }
  .fe-fld-head {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  .fe-fld-input {
    padding: 5px 7px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box;
    outline: none;
  }
  .fe-fld-input:focus { border-color: var(--text-muted); }
  .fe-fld-rm {
    background: transparent; color: var(--text-muted);
    border: 1px solid var(--card-border); cursor: pointer;
  }
  .fe-fld-rm:hover { color: var(--status-error, #c0392b); }

  .fe-add {
    align-self: flex-start;
    padding: 4px 10px;
    background: var(--bg); color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .fe-add:hover { color: var(--text-primary); }
  .fe-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }

  .fe-temp-hdr { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .fe-temp-readout { display: inline-flex; gap: 8px; align-items: baseline; font-family: var(--font-mono); font-size: 11px; }
  .fe-temp-value { color: var(--text-primary); }
  .fe-temp-word { color: var(--accent); text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px; }
  .fe-range { width: 100%; accent-color: var(--accent); cursor: pointer; }

  .fe-toggle {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: var(--text-primary);
  }
  .fe-toggle input { accent-color: var(--accent); }

  .fe-code {
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
  .fe-code:focus { border-color: var(--text-muted); }

  input[type='text'], input[type='number'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, input[type='number']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .fe-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .fe-raw summary { cursor: pointer; }
</style>
