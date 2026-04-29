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

  void definition;

  // ---------- Rule model ---------------------------------------------------
  // The panel keeps its own structured rule list and compiles to a single
  // boolean JS expression which we write into config.expression. The executor
  // reads expression verbatim, so the rule list itself is panel-internal.

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

  // Map a typed value string to a JS literal fragment.
  // Auto-detect: number → numeric literal; "true"/"false" → boolean; else → JSON-quoted string.
  function compileValue(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed === '') return '""';
    if (trimmed === 'true') return 'true';
    if (trimmed === 'false') return 'false';
    if (trimmed === 'null') return 'null';
    // Number detection: must parse as a finite number AND its toString must round-trip
    // (so "01" or "1abc" stay as strings).
    if (/^-?\d+(\.\d+)?$/.test(trimmed) && Number.isFinite(Number(trimmed))) {
      return trimmed;
    }
    return JSON.stringify(raw);
  }

  function compileRule(rule: Rule): string {
    const field = rule.field.trim() || 'input.value';
    const v = rule.value;
    switch (rule.op) {
      case '==':
        return `${field} == ${compileValue(v)}`;
      case '!=':
        return `${field} != ${compileValue(v)}`;
      case '<':
        return `${field} < ${compileValue(v)}`;
      case '<=':
        return `${field} <= ${compileValue(v)}`;
      case '>':
        return `${field} > ${compileValue(v)}`;
      case '>=':
        return `${field} >= ${compileValue(v)}`;
      case 'contains':
        return `String(${field} ?? "").includes(${compileValue(v)})`;
      case 'matches':
        // Empty regex source would match everything; require a non-empty value.
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

  function compileRules(rules: Rule[], joiner: 'AND' | 'OR'): string {
    if (rules.length === 0) return 'false';
    const parts = rules.map((r) => `(${compileRule(r)})`);
    if (parts.length === 1) return parts[0].slice(1, -1); // drop redundant outer parens
    return parts.join(joiner === 'AND' ? ' && ' : ' || ');
  }

  // ---------- Round-trip parsing ------------------------------------------
  // Try to parse an existing expression back into a single rule. We only handle
  // the simple shapes the rule builder itself emits (single rule, no joiner).
  // Anything more complex → null, and the panel falls back to advanced mode
  // without trying to round-trip.

  function tryParseSingleRule(expr: string): Rule | null {
    const src = expr.trim();
    if (!src) return null;

    // Strip a single pair of outer parens if present.
    const stripped = src.startsWith('(') && src.endsWith(')') ? src.slice(1, -1).trim() : src;

    // unary patterns first
    let m: RegExpMatchArray | null;

    // is truthy: !!(field)
    m = stripped.match(/^!!\s*\((.+)\)$/);
    if (m) return { field: m[1].trim(), op: 'is truthy', value: '' };

    // is falsy: !(field)
    m = stripped.match(/^!\s*\((.+)\)$/);
    if (m && !stripped.startsWith('!!')) return { field: m[1].trim(), op: 'is falsy', value: '' };

    // contains: String(field ?? "").includes("v")
    m = stripped.match(/^String\((.+?)\s*\?\?\s*""\)\.includes\((.+)\)$/);
    if (m) {
      const v = parseStringLiteral(m[2].trim());
      if (v !== null) return { field: m[1].trim(), op: 'contains', value: v };
    }

    // matches: new RegExp("v").test(String(field ?? ""))
    m = stripped.match(/^new RegExp\((.+?)\)\.test\(String\((.+?)\s*\?\?\s*""\)\)$/);
    if (m) {
      const v = parseStringLiteral(m[1].trim());
      if (v !== null) return { field: m[2].trim(), op: 'matches', value: v };
    }

    // binary comparisons: field OP value
    // Try the longest operators first so "<=" doesn't get parsed as "<".
    const binOps: Operator[] = ['==', '!=', '<=', '>=', '<', '>'];
    for (const op of binOps) {
      const idx = findTopLevelOp(stripped, op);
      if (idx >= 0) {
        const left = stripped.slice(0, idx).trim();
        const right = stripped.slice(idx + op.length).trim();
        // Skip === / !== (we don't emit those, but be conservative):
        if (op === '==' && stripped[idx + 2] === '=') continue;
        if (op === '!=' && stripped[idx + 2] === '=') continue;
        const v = decompileValue(right);
        if (v === null) continue;
        return { field: left, op, value: v };
      }
    }

    return null;
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
      else if (depth === 0 && src.startsWith(op, i)) {
        // Don't match "==" inside "===".
        return i;
      }
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

  // ---------- Panel state -------------------------------------------------

  const initialExpr = String(config.expression ?? '');
  const parsedInitial = tryParseSingleRule(initialExpr);

  // 'rule' = rule builder. 'advanced' = raw expression textarea.
  let mode = $state<'rule' | 'advanced'>(
    parsedInitial !== null || initialExpr.trim() === '' || initialExpr.trim() === 'false'
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

  // When user toggles into rule mode from advanced, push the compiled expr.
  // When they toggle into advanced, leave whatever's already in config (which
  // is the compiled form if they came from rule mode).
  function selectMode(next: 'rule' | 'advanced') {
    if (mode === next) return;
    mode = next;
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

  // ---------- Test evaluator ----------------------------------------------

  let sampleJson = $state('{\n  "value": 42\n}');
  let testResult = $state<null | { ok: true; value: boolean } | { ok: false; error: string }>(null);

  const expressionForTest = $derived(
    mode === 'rule' ? compiled : String(config.expression ?? ''),
  );

  function runTest() {
    let parsed: unknown;
    try {
      parsed = sampleJson.trim() ? JSON.parse(sampleJson) : {};
    } catch (err: unknown) {
      testResult = { ok: false, error: `Sample JSON: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }
    try {
      const fn = new Function('input', `return (${expressionForTest || 'false'});`) as (i: unknown) => unknown;
      const out = fn(parsed);
      testResult = { ok: true, value: !!out };
    } catch (err: unknown) {
      testResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---------- Raw JSON disclosure ----------------------------------------

  let showRawJson = $state(false);

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }
</script>

<div class="cd">
  <!-- Mode toggle -->
  <div class="cd-mode-bar" role="tablist" aria-label="Editor mode">
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'rule'}
      class="cd-mode-btn"
      class:cd-mode-btn-active={mode === 'rule'}
      onclick={() => selectMode('rule')}
    >Rule builder</button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'advanced'}
      class="cd-mode-btn"
      class:cd-mode-btn-active={mode === 'advanced'}
      onclick={() => selectMode('advanced')}
    >Advanced expression</button>
  </div>

  {#if mode === 'rule'}
    <!-- Rule builder -->
    <section class="cd-sec">
      <header class="cd-sec-hdr">
        <span class="sr-label-tight">Conditions</span>
        <span class="cd-sec-meta">{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span>
      </header>

      {#each rules as r, i (i)}
        {#if i > 0}
          <div class="cd-joiner-row">
            <div class="cd-joiner-chip" role="group" aria-label="Combine with">
              <button
                type="button"
                class="cd-chip"
                class:cd-chip-active={joiner === 'AND'}
                onclick={() => setJoiner('AND')}
              >AND</button>
              <button
                type="button"
                class="cd-chip"
                class:cd-chip-active={joiner === 'OR'}
                onclick={() => setJoiner('OR')}
              >OR</button>
            </div>
          </div>
        {/if}

        <div class="cd-rule-row">
          <label class="cd-field cd-field-fld">
            <span class="cd-label">Field</span>
            <input
              type="text"
              spellcheck="false"
              placeholder="input.value"
              value={r.field}
              oninput={(e) => updateRule(i, { field: (e.currentTarget as HTMLInputElement).value })}
            />
          </label>
          <label class="cd-field cd-field-op">
            <span class="cd-label">Operator</span>
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
            <label class="cd-field cd-field-val">
              <span class="cd-label">Value</span>
              <input
                type="text"
                spellcheck="false"
                placeholder={r.op === 'matches' ? '^prefix' : '42, true, "text"'}
                value={r.value}
                oninput={(e) => updateRule(i, { value: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
          {:else}
            <div class="cd-field cd-field-val cd-field-stub" aria-hidden="true">
              <span class="cd-label">&nbsp;</span>
              <span class="cd-stub">— no value —</span>
            </div>
          {/if}
          <button
            type="button"
            class="cd-rule-rm"
            onclick={() => removeRule(i)}
            aria-label="remove rule"
          >×</button>
        </div>
      {/each}

      <button type="button" class="cd-add" onclick={addRule}>+ Add condition</button>

      <p class="cd-hint">
        Numbers and <code>true</code>/<code>false</code> are auto-detected; everything else is treated as a string.
      </p>
    </section>

    <!-- Compiled expression preview -->
    <section class="cd-sec">
      <header class="cd-sec-hdr">
        <span class="sr-label-tight">Compiled expression</span>
        <span class="cd-sec-meta">written to <code>config.expression</code></span>
      </header>
      <code class="cd-compiled">{compiled}</code>
    </section>
  {:else}
    <!-- Advanced expression -->
    <section class="cd-sec">
      <header class="cd-sec-hdr">
        <span class="sr-label-tight">Expression</span>
      </header>
      <textarea
        class="cd-code"
        rows="4"
        spellcheck="false"
        placeholder="input.score > 80 && input.tier === 'gold'"
        value={String(config.expression ?? '')}
        oninput={(e) => setExpressionRaw((e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <p class="cd-hint">
        Use this when the rule builder can't express what you need (e.g.
        <code>input.a && input.b > 10</code> mixed AND/OR or method calls).
        Single boolean expression only — no <code>const</code>/<code>let</code>, no blocks.
      </p>
    </section>
  {/if}

  <!-- Test against sample input -->
  <section class="cd-sec">
    <header class="cd-sec-hdr">
      <span class="sr-label-tight">Test against</span>
      {#if testResult && testResult.ok}
        <span class="cd-result" class:cd-result-true={testResult.value} class:cd-result-false={!testResult.value}
          >→ {testResult.value}</span>
      {:else if testResult && !testResult.ok}
        <span class="cd-result cd-result-err">→ error: {testResult.error}</span>
      {/if}
    </header>
    <label class="cd-field">
      <span class="cd-label">Sample input JSON</span>
      <textarea
        class="cd-code"
        rows="5"
        spellcheck="false"
        value={sampleJson}
        oninput={(e) => { sampleJson = (e.currentTarget as HTMLTextAreaElement).value; }}
      ></textarea>
    </label>
    <button type="button" class="cd-test" onclick={runTest}>Test</button>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="cd-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="cd-code"
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
  .cd { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .cd-mode-bar {
    display: flex; gap: 4px;
    border: 1px solid var(--card-border);
    padding: 3px;
    align-self: flex-start;
  }
  .cd-mode-btn {
    background: transparent; color: var(--text-muted);
    border: 1px solid transparent;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    padding: 4px 10px; cursor: pointer;
  }
  .cd-mode-btn:hover { color: var(--text-primary); }
  .cd-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .cd-sec { display: flex; flex-direction: column; gap: 8px; }
  .cd-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .cd-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
  .cd-sec-meta code { font-size: 10px; color: var(--text-muted); }

  .cd-rule-row {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 1fr) 24px;
    gap: 6px;
    align-items: end;
  }
  .cd-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .cd-field-stub { justify-content: center; }
  .cd-stub {
    font-family: var(--font-mono); font-size: 11px; color: var(--text-ghost);
    padding: 6px 8px;
    border: 1px dashed var(--card-border);
    text-align: center;
  }
  .cd-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .cd-rule-rm {
    background: transparent; color: var(--text-muted);
    border: 1px solid var(--card-border); cursor: pointer;
    height: 28px; align-self: end;
  }
  .cd-rule-rm:hover { color: var(--status-error, #c0392b); }

  .cd-joiner-row { display: flex; justify-content: flex-start; }
  .cd-joiner-chip {
    display: inline-flex; gap: 0;
    border: 1px solid var(--card-border);
  }
  .cd-chip {
    background: transparent; color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    padding: 3px 10px; cursor: pointer;
  }
  .cd-chip:hover { color: var(--text-primary); }
  .cd-chip-active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .cd-add {
    align-self: flex-start;
    padding: 4px 10px;
    background: var(--bg); color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .cd-add:hover { color: var(--text-primary); }

  .cd-hint { margin: 0; font-size: 11px; color: var(--text-ghost); }
  .cd-hint code { font-size: 11px; color: var(--text-muted); }

  .cd-compiled {
    display: block;
    padding: 8px 10px;
    background: var(--bg);
    color: var(--accent);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    word-break: break-all;
  }

  .cd-code {
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
  .cd-code:focus { border-color: var(--text-muted); }

  .cd-test {
    align-self: flex-start;
    padding: 5px 14px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .cd-test:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }

  .cd-result {
    font-family: var(--font-mono); font-size: 10px;
    padding: 2px 6px;
    border: 1px solid var(--card-border);
  }
  .cd-result-true { color: var(--status-success, #2a9d4a); border-color: color-mix(in srgb, var(--status-success, #2a9d4a) 35%, transparent); }
  .cd-result-false { color: var(--text-muted); }
  .cd-result-err { color: var(--status-error, #c0392b); border-color: color-mix(in srgb, var(--status-error, #c0392b) 35%, transparent); }

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

  .cd-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .cd-raw summary { cursor: pointer; }
</style>
