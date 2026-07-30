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

  // ---------- Expression / syntax check ----------------------------------
  // The runtime executor wraps the expression with `new Function('input', expression)`,
  // so the value here is a *function body* — must contain a `return`. We mirror that
  // shape for the syntax check below: just compile, don't execute.

  const expression = $derived(String(config.expression ?? ''));

  type SyntaxStatus = { ok: true } | { ok: false; message: string };
  const syntax = $derived.by<SyntaxStatus>(() => {
    if (!expression.trim()) return { ok: true };
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      new Function('input', expression);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Test runner -------------------------------------------------
  // Panel-only: runs the user's expression in a try/catch with a parsed sample
  // input. We deliberately do NOT import the real safe-eval module — this is a
  // dev convenience inside the editor, not an execution path.

  let sampleInput = $state(
    typeof config._sampleInput === 'string' && (config._sampleInput as string).trim()
      ? (config._sampleInput as string)
      : '{ "value": 42 }',
  );

  type RunStatus =
    | { state: 'idle' }
    | { state: 'ok'; result: unknown; pretty: string }
    | { state: 'error'; message: string };

  let runStatus = $state<RunStatus>({ state: 'idle' });

  function runTest() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(sampleInput);
    } catch (err) {
      runStatus = {
        state: 'error',
        message: `Sample JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      };
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const fn = new Function('input', expression || 'return input;') as (i: unknown) => unknown;
      const raw = fn(parsed);
      const result = raw && typeof raw === 'object' ? raw : { result: raw };
      let pretty: string;
      try {
        pretty = JSON.stringify(result, null, 2);
      } catch {
        pretty = String(result);
      }
      runStatus = { state: 'ok', result, pretty };
    } catch (err) {
      runStatus = {
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Keep sample input persisted under a private key so refreshing doesn't
  // wipe a fixture the user is iterating on.
  function persistSample(value: string) {
    sampleInput = value;
    onChange({ ...config, _sampleInput: value });
  }

  // ---------- Output schema editor ---------------------------------------
  // The executor reads `config.outputSchema as JsonSchema` when it's an object.
  // We accept both shapes (object OR JSON string from a prior textarea-style
  // editor), but always write back as an object.

  type SchemaType = 'string' | 'number' | 'boolean' | 'array' | 'object';
  const SCHEMA_TYPES: SchemaType[] = ['string', 'number', 'boolean', 'array', 'object'];

  type SchemaRow = { name: string; type: SchemaType };

  function coerceSchemaType(raw: unknown): SchemaType {
    if (typeof raw === 'string' && (SCHEMA_TYPES as string[]).includes(raw)) {
      return raw as SchemaType;
    }
    return 'string';
  }

  function parseOutputSchema(raw: unknown): SchemaRow[] {
    let obj: Record<string, unknown> | null = null;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      obj = raw as Record<string, unknown>;
    } else if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          obj = parsed as Record<string, unknown>;
        }
      } catch {
        /* ignore */
      }
    }
    if (!obj) return [];
    const rows: SchemaRow[] = [];
    for (const [name, def] of Object.entries(obj)) {
      if (def && typeof def === 'object' && !Array.isArray(def)) {
        rows.push({ name, type: coerceSchemaType((def as Record<string, unknown>).type) });
      } else if (typeof def === 'string') {
        // Tolerate "{ field: 'number' }" shorthand if it ever shows up.
        rows.push({ name, type: coerceSchemaType(def) });
      }
    }
    return rows;
  }

  function buildOutputSchema(rows: SchemaRow[]): Record<string, { type: SchemaType }> {
    const out: Record<string, { type: SchemaType }> = {};
    for (const r of rows) {
      const name = r.name.trim();
      if (!name) continue;
      out[name] = { type: r.type };
    }
    return out;
  }

  const schemaRows = $derived(parseOutputSchema(config.outputSchema));

  function setSchemaRows(rows: SchemaRow[]) {
    onChange({ ...config, outputSchema: buildOutputSchema(rows) });
  }
  function addSchemaField() {
    setSchemaRows([...schemaRows, { name: '', type: 'string' }]);
  }
  function updateSchemaField(i: number, name: string, type: SchemaType) {
    const next = schemaRows.slice();
    next[i] = { name, type };
    setSchemaRows(next);
  }
  function removeSchemaField(i: number) {
    const next = schemaRows.slice();
    next.splice(i, 1);
    setSchemaRows(next);
  }

  // Schema inference: top-level keys only. For nested objects we record
  // the bare type (`object` / `array`) — we don't recurse into children
  // because the schema shape downstream nodes consume is flat
  // `{ field: { type } }`. Null becomes `string` (fallback), since there's
  // no `null` slot in the allowed set.
  function inferType(value: unknown): SchemaType {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'string';
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return t;
    if (t === 'object') return 'object';
    return 'string';
  }

  function generateFromSample() {
    if (runStatus.state !== 'ok') return;
    const result = runStatus.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return;
    const rows: SchemaRow[] = Object.entries(result as Record<string, unknown>).map(
      ([name, value]) => ({ name, type: inferType(value) }),
    );
    setSchemaRows(rows);
  }

  // ---------- Raw JSON ---------------------------------------------------
  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level header
  // renders the "What this does" preview, so we don't duplicate it here.
  void definition;
</script>

<div class="tr">
  <!-- Section 1: Transform code -->
  <section class="tr-sec">
    <header class="tr-sec-hdr">
      <span class="sr-label-tight">Transform code</span>
      {#if syntax.ok}
        <span class="tr-ok">Syntax ✓</span>
      {:else}
        <span class="tr-warn">Syntax error: {syntax.message}</span>
      {/if}
    </header>
    <textarea
      class="tr-code tr-code-wide"
      rows="10"
      spellcheck="false"
      placeholder={'return { ...input, total: input.a + input.b }'}
      value={expression}
      oninput={(e) => set('expression', (e.currentTarget as HTMLTextAreaElement).value)}
    ></textarea>
    <span class="tr-hint">
      JavaScript function body. Use <code>input</code> to read upstream data.
      <code>return</code> an object.
    </span>
    <details class="tr-cheat">
      <summary><span class="tr-cheat-summary">Scope cheatsheet</span></summary>
      <ul class="tr-cheat-list">
        <li><code>input</code> — the merged upstream output object.</li>
        <li>
          <code>previousNode</code> is <strong>not</strong> in scope — only <code>input</code>.
        </li>
        <li>
          You can use <code>const</code> / <code>let</code>, multi-line statements, and any
          standard ES built-ins (<code>JSON</code>, <code>Math</code>, <code>Date</code>, …).
        </li>
        <li>
          The body must <code>return</code> something. If you return a non-object (e.g. a
          number), it's wrapped as <code>{`{ result: <value> }`}</code>.
        </li>
      </ul>
    </details>
  </section>

  <!-- Section 2: Test runner -->
  <details class="tr-sec tr-details" open>
    <summary class="tr-sec-hdr">
      <span class="sr-label-tight">Test runner</span>
      {#if runStatus.state === 'ok'}
        <span class="tr-ok">✓ ran</span>
      {:else if runStatus.state === 'error'}
        <span class="tr-warn">✗ error</span>
      {/if}
    </summary>
    <label class="tr-field">
      <span class="tr-label">Sample input JSON</span>
      <textarea
        class="tr-code"
        rows="4"
        spellcheck="false"
        value={sampleInput}
        oninput={(e) => persistSample((e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
    </label>
    <div class="tr-run-row">
      <button type="button" class="tr-run" onclick={runTest}>Run</button>
      <span class="tr-hint">Evaluated locally in the panel — never deployed.</span>
    </div>
    {#if runStatus.state === 'ok'}
      <pre class="tr-result tr-result-ok">{runStatus.pretty}</pre>
    {:else if runStatus.state === 'error'}
      <pre class="tr-result tr-result-err"><span class="tr-warn">✗</span> {runStatus.message}</pre>
    {/if}
  </details>

  <!-- Section 3: Output schema -->
  <details class="tr-sec tr-details">
    <summary class="tr-sec-hdr">
      <span class="sr-label-tight">Declared output shape</span>
      <span class="tr-sec-meta">
        {schemaRows.length}
        {schemaRows.length === 1 ? 'field' : 'fields'}
      </span>
    </summary>
    <p class="tr-hint">
      Output schema (helps downstream nodes show autocomplete). Optional.
    </p>
    {#if schemaRows.length === 0}
      <p class="tr-empty">No fields declared.</p>
    {:else}
      <div class="tr-kv-grid">
        <div class="tr-kv-head">Field</div>
        <div class="tr-kv-head">Type</div>
        <div></div>
        {#each schemaRows as row, i (i)}
          <input
            type="text"
            class="tr-kv-input"
            placeholder="fieldName"
            value={row.name}
            oninput={(e) =>
              updateSchemaField(i, (e.currentTarget as HTMLInputElement).value, row.type)}
          />
          <select
            class="tr-kv-input"
            value={row.type}
            onchange={(e) =>
              updateSchemaField(
                i,
                row.name,
                (e.currentTarget as HTMLSelectElement).value as SchemaType,
              )}
          >
            {#each SCHEMA_TYPES as t (t)}
              <option value={t}>{t}</option>
            {/each}
          </select>
          <button
            type="button"
            class="tr-kv-rm"
            onclick={() => removeSchemaField(i)}
            aria-label="remove">×</button
          >
        {/each}
      </div>
    {/if}
    <div class="tr-schema-actions">
      <button type="button" class="tr-add" onclick={addSchemaField}>+ Add field</button>
      <button
        type="button"
        class="tr-add"
        onclick={generateFromSample}
        disabled={runStatus.state !== 'ok'}
        title={runStatus.state === 'ok'
          ? 'Infer schema from last successful test result'
          : 'Run the test runner first'}
      >
        Generate from sample
      </button>
    </div>
  </details>

  <!-- Section 4: On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="tr-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="tr-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch {
          /* invalid — keep typing */
        }
      }}
    ></textarea>
  </details>
</div>

<style>
  .tr {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 0;
  }

  .tr-sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tr-details {
    border: 1px solid var(--card-border);
    padding: 8px 10px;
    background: color-mix(in srgb, var(--accent) 3%, transparent);
  }
  .tr-details > summary {
    cursor: pointer;
    list-style: none;
  }
  .tr-details > summary::-webkit-details-marker {
    display: none;
  }
  .tr-sec-hdr {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .tr-sec-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .tr-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tr-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .tr-hint {
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }
  .tr-hint code {
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .tr-empty {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }

  .tr-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .tr-code:focus {
    border-color: var(--text-muted);
  }
  .tr-code-wide {
    line-height: 1.45;
  }

  .tr-cheat {
    border-top: 1px dashed var(--card-border);
    padding-top: 6px;
  }
  .tr-cheat > summary {
    cursor: pointer;
  }
  .tr-cheat-summary {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .tr-cheat-list {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: var(--fs-label);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .tr-cheat-list code {
    font-size: var(--fs-label);
    color: var(--accent);
  }

  .tr-run-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .tr-run {
    padding: 5px 14px;
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .tr-run:hover {
    filter: brightness(1.08);
  }

  .tr-result {
    margin: 0;
    padding: 8px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 280px;
    overflow: auto;
  }
  .tr-result-ok {
    border-left: 2px solid var(--status-success, #2a9d4a);
  }
  .tr-result-err {
    border-left: 2px solid var(--status-error, #c0392b);
    color: var(--status-error, #c0392b);
  }

  .tr-kv-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 24px;
    gap: 4px;
  }
  .tr-kv-head {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .tr-kv-input {
    padding: 5px 7px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
  }
  .tr-kv-input:focus {
    border-color: var(--text-muted);
  }
  .tr-kv-rm {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    cursor: pointer;
  }
  .tr-kv-rm:hover {
    color: var(--status-error, #c0392b);
  }

  .tr-schema-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tr-add {
    align-self: flex-start;
    padding: 4px 10px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .tr-add:hover:not(:disabled) {
    color: var(--text-primary);
  }
  .tr-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tr-warn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
  }
  .tr-ok {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--status-success, #2a9d4a);
  }

  input[type='text'],
  select,
  textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus,
  select:focus,
  textarea:focus {
    border-color: var(--text-muted);
  }

  .tr-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .tr-raw summary {
    cursor: pointer;
  }
</style>
