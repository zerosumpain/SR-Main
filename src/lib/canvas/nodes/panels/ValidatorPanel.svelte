<script lang="ts">
  import type { NodeDefinition, SchemaFieldRow } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import SchemaBuilderField from './SchemaBuilderField.svelte';

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

  // ---------- Expression rule builder (mirrors ConditionalPanel) ----------

  type Operator =
    | '=='
    | '!='
    | '<'
    | '<='
    | '>'
    | '>='
    | 'contains'
    | 'matches'
    | 'is empty'
    | 'is not empty'
    | 'is truthy'
    | 'is falsy';

  type Rule = { field: string; op: Operator; value: string };

  const UNARY_OPS: Operator[] = ['is empty', 'is not empty', 'is truthy', 'is falsy'];
  const ALL_OPS: Operator[] = [
    '==',
    '!=',
    '<',
    '<=',
    '>',
    '>=',
    'contains',
    'matches',
    'is empty',
    'is not empty',
    'is truthy',
    'is falsy',
  ];

  function isUnary(op: Operator): boolean {
    return UNARY_OPS.includes(op);
  }

  function compileValue(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed === '') return '""';
    if (trimmed === 'true') return 'true';
    if (trimmed === 'false') return 'false';
    if (trimmed === 'null') return 'null';
    if (/^-?\d+(\.\d+)?$/.test(trimmed) && Number.isFinite(Number(trimmed))) {
      return trimmed;
    }
    return JSON.stringify(raw);
  }

  function compileRule(rule: Rule): string {
    const field = rule.field.trim() || 'input.value';
    const v = rule.value;
    switch (rule.op) {
      case '==': return `${field} == ${compileValue(v)}`;
      case '!=': return `${field} != ${compileValue(v)}`;
      case '<': return `${field} < ${compileValue(v)}`;
      case '<=': return `${field} <= ${compileValue(v)}`;
      case '>': return `${field} > ${compileValue(v)}`;
      case '>=': return `${field} >= ${compileValue(v)}`;
      case 'contains':
        return `String(${field} ?? "").includes(${compileValue(v)})`;
      case 'matches':
        if (!v.trim()) return 'false';
        return `new RegExp(${compileValue(v)}).test(String(${field} ?? ""))`;
      case 'is empty':
        return `(${field} == null || ${field} === "" || (Array.isArray(${field}) && ${field}.length === 0))`;
      case 'is not empty':
        return `!(${field} == null || ${field} === "" || (Array.isArray(${field}) && ${field}.length === 0))`;
      case 'is truthy':
        return `!!(${field})`;
      case 'is falsy':
        return `!(${field})`;
    }
  }

  function compileRules(rs: Rule[], j: 'AND' | 'OR'): string {
    if (rs.length === 0) return 'false';
    const parts = rs.map((r) => `(${compileRule(r)})`);
    if (parts.length === 1) return parts[0].slice(1, -1);
    return parts.join(j === 'AND' ? ' && ' : ' || ');
  }

  function findTopLevelOp(src: string, op: string): number {
    let depth = 0;
    let inStr: string | null = null;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (c === '\\') { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (depth === 0 && src.startsWith(op, i)) return i;
    }
    return -1;
  }

  function parseStringLiteral(src: string): string | null {
    if (src.length < 2) return null;
    const q = src[0];
    if ((q === '"' || q === "'") && src[src.length - 1] === q) {
      try { return JSON.parse(q === "'" ? `"${src.slice(1, -1).replace(/"/g, '\\"')}"` : src); }
      catch { return null; }
    }
    return null;
  }

  function decompileValue(src: string): string | null {
    const trimmed = src.trim();
    if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') return trimmed;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
    const s = parseStringLiteral(trimmed);
    if (s !== null) return s;
    return null;
  }

  function tryParseSingleRule(expr: string): Rule | null {
    const src = expr.trim();
    if (!src) return null;
    const stripped = src.startsWith('(') && src.endsWith(')') ? src.slice(1, -1).trim() : src;

    let m: RegExpMatchArray | null;
    m = stripped.match(/^!!\s*\((.+)\)$/);
    if (m) return { field: m[1].trim(), op: 'is truthy', value: '' };
    m = stripped.match(/^!\s*\((.+)\)$/);
    if (m && !stripped.startsWith('!!')) return { field: m[1].trim(), op: 'is falsy', value: '' };
    m = stripped.match(/^String\((.+?)\s*\?\?\s*""\)\.includes\((.+)\)$/);
    if (m) {
      const v = parseStringLiteral(m[2].trim());
      if (v !== null) return { field: m[1].trim(), op: 'contains', value: v };
    }
    m = stripped.match(/^new RegExp\((.+?)\)\.test\(String\((.+?)\s*\?\?\s*""\)\)$/);
    if (m) {
      const v = parseStringLiteral(m[1].trim());
      if (v !== null) return { field: m[2].trim(), op: 'matches', value: v };
    }

    const binOps: Operator[] = ['==', '!=', '<=', '>=', '<', '>'];
    for (const op of binOps) {
      const idx = findTopLevelOp(stripped, op);
      if (idx >= 0) {
        if (op === '==' && stripped[idx + 2] === '=') continue;
        if (op === '!=' && stripped[idx + 2] === '=') continue;
        const left = stripped.slice(0, idx).trim();
        const right = stripped.slice(idx + op.length).trim();
        const v = decompileValue(right);
        if (v === null) continue;
        return { field: left, op, value: v };
      }
    }
    return null;
  }

  // ---------- Expression panel state -------------------------------------

  const initialExpr = String(config.expression ?? '');
  const parsedInitial = tryParseSingleRule(initialExpr);

  let exprMode = $state<'rule' | 'advanced'>(
    parsedInitial !== null || initialExpr.trim() === '' || initialExpr.trim() === 'true' || initialExpr.trim() === 'false'
      ? 'rule'
      : 'advanced',
  );
  let rules = $state<Rule[]>(
    parsedInitial
      ? [parsedInitial]
      : [{ field: 'input.value', op: '==' as Operator, value: '' }],
  );
  let joiner = $state<'AND' | 'OR'>('AND');

  const compiled = $derived(compileRules(rules, joiner));

  function commitFromRules() {
    onChange({ ...config, expression: compiled });
  }

  function setExpressionRaw(expr: string) {
    onChange({ ...config, expression: expr });
  }

  function selectExprMode(next: 'rule' | 'advanced') {
    if (exprMode === next) return;
    exprMode = next;
    if (next === 'rule') commitFromRules();
  }

  function updateRule(i: number, patch: Partial<Rule>) {
    const next = rules.slice();
    next[i] = { ...next[i], ...patch };
    rules = next;
    commitFromRules();
  }
  function addRule() {
    rules = [...rules, { field: 'input.value', op: '==' as Operator, value: '' }];
    commitFromRules();
  }
  function removeRule(i: number) {
    const next = rules.slice();
    next.splice(i, 1);
    rules = next.length ? next : [{ field: 'input.value', op: '==' as Operator, value: '' }];
    commitFromRules();
  }
  function setJoiner(j: 'AND' | 'OR') {
    if (joiner === j) return;
    joiner = j;
    commitFromRules();
  }

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

  const expressionForTest = $derived(
    exprMode === 'rule' ? compiled : String(config.expression ?? ''),
  );

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

  let showRawJson = $state(false);
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
    <!-- Sub-mode toggle (rule builder vs raw expression) -->
    <div class="va-submode-bar" role="tablist" aria-label="Expression editor mode">
      <button
        type="button"
        role="tab"
        aria-selected={exprMode === 'rule'}
        class="va-mode-btn"
        class:va-mode-btn-active={exprMode === 'rule'}
        onclick={() => selectExprMode('rule')}
      >Rule builder</button>
      <button
        type="button"
        role="tab"
        aria-selected={exprMode === 'advanced'}
        class="va-mode-btn"
        class:va-mode-btn-active={exprMode === 'advanced'}
        onclick={() => selectExprMode('advanced')}
      >Advanced</button>
    </div>

    {#if exprMode === 'rule'}
      <section class="va-sec">
        <header class="va-sec-hdr">
          <span class="sr-label-tight">Conditions</span>
          <span class="va-sec-meta">{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span>
        </header>

        {#each rules as r, i (i)}
          {#if i > 0}
            <div class="va-joiner-row">
              <div class="va-joiner-chip" role="group" aria-label="Combine with">
                <button type="button" class="va-chip" class:va-chip-active={joiner === 'AND'} onclick={() => setJoiner('AND')}>AND</button>
                <button type="button" class="va-chip" class:va-chip-active={joiner === 'OR'} onclick={() => setJoiner('OR')}>OR</button>
              </div>
            </div>
          {/if}
          <div class="va-rule-row">
            <label class="va-field va-field-fld">
              <span class="va-label">Field</span>
              <input
                type="text"
                spellcheck="false"
                placeholder="input.value"
                value={r.field}
                oninput={(e) => updateRule(i, { field: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <label class="va-field va-field-op">
              <span class="va-label">Operator</span>
              <select
                value={r.op}
                onchange={(e) => updateRule(i, { op: (e.currentTarget as HTMLSelectElement).value as Operator })}
              >
                {#each ALL_OPS as op (op)}
                  <option value={op}>{op}</option>
                {/each}
              </select>
            </label>
            {#if !isUnary(r.op)}
              <label class="va-field va-field-val">
                <span class="va-label">Value</span>
                <input
                  type="text"
                  spellcheck="false"
                  placeholder={r.op === 'matches' ? '^prefix' : '42, true, "text"'}
                  value={r.value}
                  oninput={(e) => updateRule(i, { value: (e.currentTarget as HTMLInputElement).value })}
                />
              </label>
            {:else}
              <div class="va-field va-field-val va-field-stub" aria-hidden="true">
                <span class="va-label">&nbsp;</span>
                <span class="va-stub">— no value —</span>
              </div>
            {/if}
            <button
              type="button"
              class="va-rule-rm"
              onclick={() => removeRule(i)}
              aria-label="remove rule"
            >×</button>
          </div>
        {/each}

        <button type="button" class="va-add" onclick={addRule}>+ Add condition</button>
        <p class="va-hint">
          Numbers and <code>true</code>/<code>false</code> are auto-detected; everything else is treated as a string.
        </p>
      </section>

      <section class="va-sec">
        <header class="va-sec-hdr">
          <span class="sr-label-tight">Compiled expression</span>
          <span class="va-sec-meta">written to <code>config.expression</code></span>
        </header>
        <code class="va-compiled">{compiled}</code>
      </section>
    {:else}
      <section class="va-sec">
        <header class="va-sec-hdr">
          <span class="sr-label-tight">Expression</span>
        </header>
        <textarea
          class="va-code"
          rows="4"
          spellcheck="false"
          placeholder="input.score >= 80 && input.tier === 'gold'"
          value={String(config.expression ?? '')}
          oninput={(e) => setExpressionRaw((e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <p class="va-hint">
          Single boolean expression evaluated against <code>input</code>. Routes to <strong>pass</strong> when truthy, <strong>fail</strong> otherwise.
        </p>
      </section>
    {/if}
  {:else}
    <!-- Schema mode -->
    <section class="va-sec">
      <header class="va-sec-hdr">
        <span class="sr-label-tight">Expected fields</span>
        <span class="va-sec-meta">{schemaRows.length} {schemaRows.length === 1 ? 'field' : 'fields'}</span>
      </header>
      <SchemaBuilderField value={schemaRows} onChange={setSchemaRows} />
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
  <details class="va-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="va-code"
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
  .va { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .va-handles {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    padding: 6px 10px;
  }
  .va-handles-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-right: 4px;
  }
  .va-handle {
    font-family: var(--font-mono); font-size: 10px;
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
    font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost);
  }
  .va-handle-sep {
    color: var(--text-ghost); margin: 0 4px;
  }

  .va-mode-bar, .va-submode-bar {
    display: flex; gap: 4px;
    border: 1px solid var(--card-border);
    padding: 3px;
    align-self: flex-start;
  }
  .va-mode-btn {
    background: transparent; color: var(--text-muted);
    border: 1px solid transparent;
    font-family: var(--font-mono); font-size: 10px;
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
  .va-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
  .va-sec-meta code { font-size: 10px; color: var(--text-muted); }

  .va-rule-row {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 1fr) 24px;
    gap: 6px;
    align-items: end;
  }
  .va-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .va-field-stub { justify-content: center; }
  .va-stub {
    font-family: var(--font-mono); font-size: 11px; color: var(--text-ghost);
    padding: 6px 8px;
    border: 1px dashed var(--card-border);
    text-align: center;
  }
  .va-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .va-rule-rm {
    background: transparent; color: var(--text-muted);
    border: 1px solid var(--card-border); cursor: pointer;
    height: 28px; align-self: end;
  }
  .va-rule-rm:hover { color: var(--status-error, #c0392b); }

  .va-joiner-row { display: flex; justify-content: flex-start; }
  .va-joiner-chip {
    display: inline-flex; gap: 0;
    border: 1px solid var(--card-border);
  }
  .va-chip {
    background: transparent; color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    padding: 3px 10px; cursor: pointer;
  }
  .va-chip:hover { color: var(--text-primary); }
  .va-chip-active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .va-add {
    align-self: flex-start;
    padding: 4px 10px;
    background: var(--bg); color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .va-add:hover { color: var(--text-primary); }

  .va-hint { margin: 0; font-size: 11px; color: var(--text-ghost); }
  .va-hint code { font-size: 11px; color: var(--text-muted); }

  .va-compiled {
    display: block;
    padding: 8px 10px;
    background: var(--bg);
    color: var(--accent);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    word-break: break-all;
  }

  .va-code {
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
  .va-code:focus { border-color: var(--text-muted); }

  .va-test {
    align-self: flex-start;
    padding: 5px 14px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .va-test:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }

  .va-result {
    font-family: var(--font-mono); font-size: 10px;
    padding: 2px 6px;
    border: 1px solid var(--card-border);
  }
  .va-result-true { color: var(--status-success, #2a9d4a); border-color: color-mix(in srgb, var(--status-success, #2a9d4a) 35%, transparent); }
  .va-result-false { color: var(--text-muted); }
  .va-result-err { color: var(--status-error, #c0392b); border-color: color-mix(in srgb, var(--status-error, #c0392b) 35%, transparent); }

  .va-errs {
    margin: 0;
    padding-left: 16px;
    font-size: 11px;
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

  .va-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .va-raw summary { cursor: pointer; }
</style>
