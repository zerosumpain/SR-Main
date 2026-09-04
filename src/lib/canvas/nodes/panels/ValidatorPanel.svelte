<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition, SchemaFieldRow } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import SchemaFieldTable from './widgets/SchemaFieldTable.svelte';
  import ExpressionRuleBuilder from './widgets/ExpressionRuleBuilder.svelte';

  let {
    config,
    onChange,
    definition,
    upstreamFields = [],
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
    upstreamFields?: string[];
  } = $props();

  void definition;

  // ----------------------------------------------------------------------
  // The validator executor branches on `config.mode`:
  //   'expression' → reads `config.expression`, a JS boolean expression
  //                  evaluated against `input` (Conditional-style).
  //   'schema'     → reads `config.schema`, accepted either as a
  //                  SchemaFieldRow[] (new shape) or a JSON-Schema string
  //                  (legacy textarea shape).
  // The two output handles (`pass` / `fail`) are wired by edges, not config.
  // ----------------------------------------------------------------------

  const mode = $derived<'expression' | 'schema'>(
    String(config.mode ?? 'expression') === 'schema' ? 'schema' : 'expression',
  );

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function selectMode(next: 'expression' | 'schema') {
    if (mode === next) return;
    set('mode', next);
  }

  // ---------- Expression mode now provided by <ExpressionRuleBuilder/> ----------

  // ---------- Schema-builder helpers --------------------------------------

  // Schema may be SchemaFieldRow[] or a JSON-Schema string. Normalise to rows
  // for the table editor; persist back as SchemaFieldRow[] (executor accepts
  // both, and the new shape round-trips cleanly).
  function schemaStringToRows(raw: string): SchemaFieldRow[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const obj = JSON.parse(trimmed);
      if (!obj || typeof obj !== 'object') return [];
      const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
      const props = (obj.properties && typeof obj.properties === 'object')
        ? (obj.properties as Record<string, { type?: string }>)
        : {};
      const rows: SchemaFieldRow[] = [];
      for (const [name, prop] of Object.entries(props)) {
        const t = (prop?.type as SchemaFieldRow['type']) ?? 'string';
        const allowed: SchemaFieldRow['type'][] = ['string', 'number', 'boolean', 'object', 'array'];
        rows.push({
          name,
          type: allowed.includes(t) ? t : 'string',
          required: required.includes(name),
        });
      }
      return rows;
    } catch {
      return [];
    }
  }

  const schemaRows = $derived<SchemaFieldRow[]>(
    Array.isArray(config.schema)
      ? (config.schema as SchemaFieldRow[])
      : typeof config.schema === 'string'
        ? schemaStringToRows(config.schema)
        : [],
  );

  function setSchemaRows(rows: SchemaFieldRow[]) {
    onChange({ ...config, schema: rows });
  }

  // ---------- Test runner -------------------------------------------------

  let sampleJson = $state('{\n  "value": 42\n}');
  let testResult = $state<
    | null
    | { ok: true; valid: boolean; errors: string[] }
    | { ok: false; error: string }
  >(null);

  const expressionForTest = $derived(String(config.expression ?? ''));

  function checkType(value: unknown, expectedType: string): boolean {
    if (expectedType === 'any') return true;
    if (expectedType === 'array') return Array.isArray(value);
    if (expectedType === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    return typeof value === expectedType;
  }

  function runTest() {
    let parsed: Record<string, unknown>;
    try {
      const raw = sampleJson.trim() ? JSON.parse(sampleJson) : {};
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        parsed = raw as Record<string, unknown>;
      } else {
        testResult = { ok: false, error: 'Sample input must be a JSON object.' };
        return;
      }
    } catch (err: unknown) {
      testResult = { ok: false, error: `Sample JSON: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }

    if (mode === 'expression') {
      const expr = expressionForTest.trim();
      if (!expr) {
        testResult = { ok: true, valid: false, errors: ['Empty expression'] };
        return;
      }
      try {
        const fn = new Function('input', `return !!(${expr});`) as (i: unknown) => unknown;
        const out = fn(parsed);
        testResult = { ok: true, valid: !!out, errors: [] };
      } catch (err: unknown) {
        testResult = { ok: true, valid: false, errors: [`Expression error: ${err instanceof Error ? err.message : String(err)}`] };
      }
      return;
    }

    // schema mode
    const errors: string[] = [];
    for (const row of schemaRows) {
      if (!row.name) continue;
      const present = row.name in parsed && parsed[row.name] !== undefined && parsed[row.name] !== null;
      if (row.required && !present) {
        errors.push(`Missing required field: ${row.name}`);
        continue;
      }
      if (present && !checkType(parsed[row.name], row.type)) {
        errors.push(
          `Field "${row.name}" expected type ${row.type}, got ${Array.isArray(parsed[row.name]) ? 'array' : typeof parsed[row.name]}`,
        );
      }
    }
    testResult = { ok: true, valid: errors.length === 0, errors };
  }

  // ---------- Raw JSON disclosure ----------------------------------------
</script>

<div class="va">
  <!-- Output handle indicator: this node has two outgoing edges, wired by handle name -->
  <section class="va-handles" aria-label="Output handles">
    <span class="va-handles-label">Outputs</span>
    <span class="va-handle va-handle-pass">pass</span>
    <span class="va-handle-arrow">→ truthy / valid</span>
    <span class="va-handle-sep" aria-hidden="true">·</span>
    <span class="va-handle va-handle-fail">fail</span>
    <span class="va-handle-arrow">→ falsy / invalid</span>
  </section>

  <!-- Mode toggle: schema vs expression -->
  <div class="va-mode-bar" role="tablist" aria-label="Validator mode">
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'expression'}
      class="va-mode-btn"
      class:va-mode-btn-active={mode === 'expression'}
      onclick={() => selectMode('expression')}
    >Expression</button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'schema'}
      class="va-mode-btn"
      class:va-mode-btn-active={mode === 'schema'}
      onclick={() => selectMode('schema')}
    >JSON Schema</button>
  </div>

  {#if mode === 'expression'}
    <ExpressionRuleBuilder
      value={String(config.expression ?? '')}
      onChange={(expr) => set('expression', expr)}
      upstreamFields={upstreamFields}
      advancedPlaceholder="input.score >= 80 && input.tier === 'gold'"
      advancedHint="Single boolean expression evaluated against <code>input</code>. Routes to <strong>pass</strong> when truthy, <strong>fail</strong> otherwise."
    />
  {:else}
    <!-- Schema mode -->
    <section class="va-sec">
      <header class="va-sec-hdr">
        <span class="sr-label-tight">Expected fields</span>
        <span class="va-sec-meta">{schemaRows.length} {schemaRows.length === 1 ? 'field' : 'fields'}</span>
      </header>
      <SchemaFieldTable value={schemaRows} onChange={setSchemaRows} />
      <p class="va-hint">
        Each row asserts a property on <code>input</code>. Required fields must be present and non-null;
        present fields must match the declared type. Routes to <strong>pass</strong> if all checks succeed.
      </p>
    </section>
  {/if}

  <!-- Test runner -->
  <section class="va-sec">
    <header class="va-sec-hdr">
      <span class="sr-label-tight">Test against</span>
      {#if testResult && testResult.ok}
        <span class="va-result" class:va-result-true={testResult.valid} class:va-result-false={!testResult.valid}
          >→ {testResult.valid ? 'pass' : 'fail'}</span>
      {:else if testResult && !testResult.ok}
        <span class="va-result va-result-err">→ error: {testResult.error}</span>
      {/if}
    </header>
    <label class="va-field">
      <span class="va-label">Sample input JSON</span>
      <textarea
        class="va-code"
        rows="5"
        spellcheck="false"
        value={sampleJson}
        oninput={(e) => { sampleJson = (e.currentTarget as HTMLTextAreaElement).value; }}
      ></textarea>
    </label>
    {#if testResult && testResult.ok && testResult.errors.length > 0}
      <ul class="va-errs">
        {#each testResult.errors as err (err)}
          <li>{err}</li>
        {/each}
      </ul>
    {/if}
    <button type="button" class="va-test" onclick={runTest}>Test</button>
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
  .va { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .va-handles {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    padding: 6px 10px;
  }
  .va-handles-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-right: 4px;
  }
  .va-handle {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    padding: 2px 8px;
    border: 1px solid var(--card-border);
  }
  .va-handle-pass {
    color: var(--status-success, #2a9d4a);
    border-color: color-mix(in srgb, var(--status-success, #2a9d4a) 35%, transparent);
    background: color-mix(in srgb, var(--status-success, #2a9d4a) 8%, transparent);
  }
  .va-handle-fail {
    color: var(--status-error, #c0392b);
    border-color: color-mix(in srgb, var(--status-error, #c0392b) 35%, transparent);
    background: color-mix(in srgb, var(--status-error, #c0392b) 8%, transparent);
  }
  .va-handle-arrow {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost);
  }
  .va-handle-sep {
    color: var(--text-ghost); margin: 0 4px;
  }

  .va-mode-bar {
    display: flex; gap: 4px;
    border: 1px solid var(--card-border);
    padding: 3px;
    align-self: flex-start;
  }
  .va-mode-btn {
    background: transparent; color: var(--text-muted);
    border: 1px solid transparent;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    padding: 4px 10px; cursor: pointer;
  }
  .va-mode-btn:hover { color: var(--text-primary); }
  .va-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .va-sec { display: flex; flex-direction: column; gap: 8px; }
  .va-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .va-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .va-sec-meta code { font-size: var(--fs-label-xs); color: var(--text-muted); }

  .va-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .va-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .va-hint { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }
  .va-hint code { font-size: var(--fs-label); color: var(--text-muted); }

  .va-code {
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
  .va-code:focus { border-color: var(--text-muted); }

  .va-test {
    align-self: flex-start;
    padding: 5px 14px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .va-test:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }

  .va-result {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    padding: 2px 6px;
    border: 1px solid var(--card-border);
  }
  .va-result-true { color: var(--status-success, #2a9d4a); border-color: color-mix(in srgb, var(--status-success, #2a9d4a) 35%, transparent); }
  .va-result-false { color: var(--text-muted); }
  .va-result-err { color: var(--status-error, #c0392b); border-color: color-mix(in srgb, var(--status-error, #c0392b) 35%, transparent); }

  .va-errs {
    margin: 0;
    padding-left: 16px;
    font-size: var(--fs-label);
    color: var(--status-error, #c0392b);
  }
  .va-errs li { font-family: var(--font-mono); }

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
