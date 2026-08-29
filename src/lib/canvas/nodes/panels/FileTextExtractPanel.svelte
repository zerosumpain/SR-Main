<script lang="ts">
  // FileTextExtractPanel — structured editor for the `file-text-extract` node.
  // The executor in src/lib/workflows/nodes/file-text-extract.ts reads:
  //   fileName    (required, supports {{input.x}} templates)
  //   pageFrom    (PDF only, 1-indexed)
  //   pageTo      (PDF only, inclusive)
  //   language    (audio/video, BCP-47)
  //   persist     (truthy → save extracted text as a new .txt file)
  //   outputName  (required when persist, supports templates)
  //
  // The panel models a small "fields to extract" table (name + type +
  // description). When at least one row has a non-empty name we synthesise a
  // JSON Schema and write it back to `config.extractSchema` so a downstream
  // LLM step (or future schema-aware extractor) can consume it. The current
  // file-text-extract executor ignores extractSchema, but persisting it keeps
  // the canvas-level intent clear and forwards-compatible.
  //
  // Unknown keys are preserved via spread; the canvas-level header still
  // renders the "What this does" preview, so we don't duplicate it.

  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import FilePicker from './shared/FilePicker.svelte';

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
    { value: 'z-ai/glm-5-turbo', label: 'GLM 5 Turbo' },
    { value: 'z-ai/glm-5.2', label: 'GLM 5.2' },
    { value: 'z-ai/glm-5.1', label: 'GLM 5.1' },
    { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
    { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (fast)' },
    { value: 'google/gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
    { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  ];

  // ---------- Fields-to-extract row model ---------------------------------

  type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';
  type FieldRow = { name: string; type: FieldType; description: string };

  const TYPES: FieldType[] = ['string', 'number', 'boolean', 'array', 'object'];

  // The rows are stored under `config.extractFields` (an array of
  // {name,type,description}). On every edit we also recompute and persist
  // `config.extractSchema` (a JSON Schema object) so executors that prefer
  // the schema shape don't have to re-derive it.
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

  const fileName = $derived(String(config.fileName ?? ''));
  const pageFrom = $derived(String(config.pageFrom ?? ''));
  const pageTo = $derived(String(config.pageTo ?? ''));
  const language = $derived(String(config.language ?? ''));
  const persist = $derived(toBool(config.persist));
  const outputName = $derived(String(config.outputName ?? ''));

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

<div class="ft">
  <!-- Source file -->
  <section class="ft-sec">
    <header class="ft-sec-hdr">
      <span class="sr-label-tight">Source file</span>
    </header>
    <div class="ft-field">
      <span class="ft-label">File name in the workflow file store</span>
      <FilePicker
        value={fileName}
        mode="read"
        placeholder={'docs/contract.pdf or {{input.upload.name}}'}
        onChange={(v) => set('fileName', v)}
        hint={'Required. Pick from the file store, or type a templated name. Templates supported: {{input.field}}.'}
      />
      {#if !fileName.trim()}<span class="ft-warn">empty - workflow will fail at runtime</span>{/if}
    </div>
  </section>

  <!-- PDF page range + language -->
  <section class="ft-sec">
    <header class="ft-sec-hdr">
      <span class="sr-label-tight">Format-specific options</span>
      <span class="ft-sec-meta">PDF + audio/video</span>
    </header>
    <div class="ft-row">
      <label class="ft-field ft-field-third">
        <span class="ft-label">First page (PDF)</span>
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
      <label class="ft-field ft-field-third">
        <span class="ft-label">Last page (PDF)</span>
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
      <label class="ft-field ft-field-third">
        <span class="ft-label">Language (audio/video)</span>
        <input
          type="text"
          placeholder="en"
          value={language}
          oninput={(e) => set('language', (e.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </div>
    <span class="ft-hint">
      Pages are 1-indexed and inclusive; leave both empty for the full document.
      Language is a BCP-47 hint passed to Whisper (e.g. <code>en</code>, <code>es</code>); leave empty for auto-detect.
    </span>
  </section>

  <!-- Fields to extract (structured-output schema builder) -->
  <section class="ft-sec">
    <header class="ft-sec-hdr">
      <span class="sr-label-tight">Fields to extract</span>
      <span class="ft-sec-meta">{rows.length} {rows.length === 1 ? 'field' : 'fields'}</span>
    </header>
    {#if rows.length === 0}
      <p class="ft-empty">No structured fields. The node returns plain text only.</p>
    {:else}
      <div class="ft-fld-grid">
        <div class="ft-fld-head">Name</div>
        <div class="ft-fld-head">Type</div>
        <div class="ft-fld-head">Description (sent to model)</div>
        <div></div>
        {#each rows as row, i (i)}
          <input
            type="text"
            class="ft-fld-input"
            placeholder="title"
            value={row.name}
            oninput={(e) => updateRow(i, { name: (e.currentTarget as HTMLInputElement).value })}
          />
          <select
            class="ft-fld-input"
            value={row.type}
            onchange={(e) => updateRow(i, { type: (e.currentTarget as HTMLSelectElement).value as FieldType })}
          >
            {#each TYPES as t (t)}<option value={t}>{t}</option>{/each}
          </select>
          <input
            type="text"
            class="ft-fld-input"
            placeholder="Document title at the top of the page"
            value={row.description}
            oninput={(e) => updateRow(i, { description: (e.currentTarget as HTMLInputElement).value })}
          />
          <button type="button" class="ft-fld-rm" onclick={() => removeRow(i)} aria-label="remove">×</button>
        {/each}
      </div>
    {/if}
    <button type="button" class="ft-add" onclick={addRow}>+ Add field</button>
    <span class="ft-hint">
      A JSON Schema is built from these rows and stored under <code>extractSchema</code>
      so a downstream LLM step (or schema-aware extractor) can consume it directly.
    </span>
  </section>

  <!-- Model + temperature (only meaningful when fields are defined) -->
  <section class="ft-sec">
    <header class="ft-sec-hdr">
      <span class="sr-label-tight">Model</span>
      <span class="ft-sec-meta">used by downstream LLM extraction</span>
    </header>
    <label class="ft-field">
      <span class="ft-label">Model</span>
      <select value={model} onchange={(e) => set('model', (e.currentTarget as HTMLSelectElement).value)}>
        {#if !modelInList}<option value={model}>Custom: {model}</option>{/if}
        {#each MODEL_OPTIONS as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      <span class="ft-hint">Leave on Default to use the admin-configured site default.</span>
    </label>
    <div class="ft-field">
      <div class="ft-temp-hdr">
        <span class="ft-label">Temperature</span>
        <span class="ft-temp-readout">
          <span class="ft-temp-value">{temperature.toFixed(1)}</span>
          <span class="ft-temp-word">{tempDescriptor}</span>
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="2"
        step="0.1"
        value={temperature}
        oninput={(e) => set('temperature', Number((e.currentTarget as HTMLInputElement).value))}
        class="ft-range"
      />
      <span class="ft-hint">0 = focused / deterministic - 0.7 = balanced - 1.5+ = creative.</span>
    </div>
  </section>

  <!-- Persist -->
  <section class="ft-sec">
    <header class="ft-sec-hdr">
      <span class="sr-label-tight">Persist extracted text</span>
    </header>
    <label class="ft-toggle">
      <input
        type="checkbox"
        checked={persist}
        onchange={(e) => set('persist', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Save the extracted plain text as a new <code>.txt</code> file in the store</span>
    </label>
    {#if persist}
      <div class="ft-field">
        <span class="ft-label">Saved file name</span>
        <FilePicker
          value={outputName}
          mode="write"
          placeholder={'extracted/{{input.upload.name}}.txt'}
          onChange={(v) => set('outputName', v)}
          hint="Templates supported. Type a new path, or pick an existing file to overwrite. Defaults to <source>.extracted.txt when blank."
        />
      </div>
    {/if}
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="ft-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced - raw JSON config</span></summary>
    <textarea
      class="ft-code"
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
  .ft { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .ft-sec { display: flex; flex-direction: column; gap: 8px; }
  .ft-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .ft-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .ft-row { display: flex; gap: 8px; }
  .ft-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .ft-field-third { flex: 1; }
  .ft-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .ft-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .ft-hint code, .ft-label code { font-size: var(--fs-label); color: var(--text-muted); }
  .ft-warn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-error, #c0392b); margin-left: 6px; }

  .ft-fld-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 110px minmax(0, 1.6fr) 24px;
    gap: 4px;
    align-items: center;
  }
  .ft-fld-head {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  .ft-fld-input {
    padding: 5px 7px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
  }
  .ft-fld-input:focus { border-color: var(--text-muted); }
  .ft-fld-rm {
    background: transparent; color: var(--text-muted);
    border: 1px solid var(--card-border); cursor: pointer;
  }
  .ft-fld-rm:hover { color: var(--status-error, #c0392b); }

  .ft-add {
    align-self: flex-start;
    padding: 4px 10px;
    background: var(--bg); color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .ft-add:hover { color: var(--text-primary); }
  .ft-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }

  .ft-temp-hdr { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .ft-temp-readout { display: inline-flex; gap: 8px; align-items: baseline; font-family: var(--font-mono); font-size: var(--fs-label); }
  .ft-temp-value { color: var(--text-primary); }
  .ft-temp-word { color: var(--accent); text-transform: uppercase; letter-spacing: 0.06em; font-size: var(--fs-label-xs); }
  .ft-range { width: 100%; accent-color: var(--accent); cursor: pointer; }

  .ft-toggle {
    display: flex; align-items: center; gap: 8px;
    font-size: var(--fs-label); color: var(--text-primary);
  }
  .ft-toggle input { accent-color: var(--accent); }

  .ft-code {
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
  .ft-code:focus { border-color: var(--text-muted); }

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

  .ft-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .ft-raw summary { cursor: pointer; }
</style>
