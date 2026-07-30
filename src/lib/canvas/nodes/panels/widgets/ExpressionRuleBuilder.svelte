<script lang="ts">
  // Boolean-expression editor with two modes:
  //   - rule   → structured field/operator/value rows joined with AND/OR
  //   - advanced → raw JS expression textarea
  //
  // Owns its rule-list state internally and emits the compiled JS
  // expression string via onChange. On mount, attempts to round-trip the
  // incoming `value` back into a single rule via tryParseSingleRule —
  // anything more complex starts in advanced mode (so users editing
  // hand-written expressions don't lose them).

  import UpstreamFieldPicker from '../shared/UpstreamFieldPicker.svelte';
  import {
    ALL_OPS,
    compileRules,
    isUnary,
    tryParseSingleRule,
    type Operator,
    type Rule,
  } from './expression-rules';

  let {
    value,
    onChange,
    upstreamFields = [],
    advancedPlaceholder = 'input.field == "value"',
    advancedHint,
  }: {
    /** Current expression string (config.expression). */
    value: string;
    /** Called with the new compiled expression on any rule edit / textarea change. */
    onChange: (expr: string) => void;
    /** Upstream field paths for the field picker. */
    upstreamFields?: string[];
    advancedPlaceholder?: string;
    /** Hint shown beneath the advanced textarea (HTML). */
    advancedHint?: string;
  } = $props();

  // Upstream paths arrive as bare keys (e.g. "body.results.0.id"); the rule
  // builder writes them as `input.body.results.0.id` to match the eval
  // context. We expose both forms so the user sees what they expect
  // regardless of which side they're typing on.
  const upstreamWithInputPrefix = $derived(
    upstreamFields.map((p) => (p.startsWith('input.') ? p : `input.${p}`)),
  );

  const parsedInitial = tryParseSingleRule(value);

  let mode = $state<'rule' | 'advanced'>(
    parsedInitial !== null || value.trim() === '' || value.trim() === 'false'
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
    onChange(compiled);
  }

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
</script>

<div class="erb">
  <div class="erb-mode-bar" role="tablist" aria-label="Editor mode">
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'rule'}
      class="erb-mode-btn"
      class:erb-mode-btn-active={mode === 'rule'}
      onclick={() => selectMode('rule')}
    >Rule builder</button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'advanced'}
      class="erb-mode-btn"
      class:erb-mode-btn-active={mode === 'advanced'}
      onclick={() => selectMode('advanced')}
    >Advanced expression</button>
  </div>

  {#if mode === 'rule'}
    <section class="erb-sec">
      <header class="erb-sec-hdr">
        <span class="sr-label-tight">Conditions</span>
        <span class="erb-sec-meta">{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span>
      </header>

      {#each rules as r, i (i)}
        {#if i > 0}
          <div class="erb-joiner-row">
            <div class="erb-joiner-chip" role="group" aria-label="Combine with">
              <button
                type="button"
                class="erb-chip"
                class:erb-chip-active={joiner === 'AND'}
                onclick={() => setJoiner('AND')}
              >AND</button>
              <button
                type="button"
                class="erb-chip"
                class:erb-chip-active={joiner === 'OR'}
                onclick={() => setJoiner('OR')}
              >OR</button>
            </div>
          </div>
        {/if}

        <div class="erb-rule-row">
          <label class="erb-field erb-field-fld">
            <UpstreamFieldPicker
              label="Field"
              value={r.field}
              upstreamFields={upstreamWithInputPrefix}
              placeholder="pick or type input.<path>"
              allowCustom={true}
              onChange={(v) => updateRule(i, { field: v })}
            />
          </label>
          <label class="erb-field erb-field-op">
            <span class="erb-label">Operator</span>
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
            <label class="erb-field erb-field-val">
              <span class="erb-label">Value</span>
              <input
                type="text"
                spellcheck="false"
                placeholder={r.op === 'matches' ? '^prefix' : '42, true, "text"'}
                value={r.value}
                oninput={(e) => updateRule(i, { value: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
          {:else}
            <div class="erb-field erb-field-val erb-field-stub" aria-hidden="true">
              <span class="erb-label">&nbsp;</span>
              <span class="erb-stub">— no value —</span>
            </div>
          {/if}
          <button
            type="button"
            class="erb-rule-rm"
            onclick={() => removeRule(i)}
            aria-label="Remove rule"
          >×</button>
        </div>
      {/each}

      <button type="button" class="erb-add" onclick={addRule}>+ Add rule</button>
      <pre class="erb-compiled">{compiled}</pre>
    </section>
  {:else}
    <section class="erb-sec">
      <label class="erb-field">
        <span class="erb-label">JS boolean expression</span>
        <textarea
          class="erb-code"
          rows="3"
          spellcheck="false"
          placeholder={advancedPlaceholder}
          value={value}
          oninput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        {#if advancedHint}<span class="erb-hint">{@html advancedHint}</span>{/if}
      </label>
    </section>
  {/if}
</div>

<style>
  .erb { display: flex; flex-direction: column; gap: 10px; }

  .erb-mode-bar {
    display: inline-flex;
    border: 1px solid var(--card-border);
    align-self: flex-start;
  }
  .erb-mode-btn {
    padding: 4px 10px;
    background: var(--bg);
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .erb-mode-btn + .erb-mode-btn { border-left: 1px solid var(--card-border); }
  .erb-mode-btn:hover { color: var(--text-primary); }
  .erb-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-primary);
  }

  .erb-sec { display: flex; flex-direction: column; gap: 8px; }
  .erb-sec-hdr {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }
  .erb-sec-meta {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-ghost);
  }

  .erb-joiner-row { display: flex; justify-content: flex-start; }
  .erb-joiner-chip {
    display: inline-flex; border: 1px solid var(--card-border);
  }
  .erb-chip {
    padding: 2px 8px;
    background: var(--bg); color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .erb-chip + .erb-chip { border-left: 1px solid var(--card-border); }
  .erb-chip:hover { color: var(--text-primary); }
  .erb-chip-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-primary);
  }

  .erb-rule-row {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) 130px minmax(0, 1fr) 24px;
    gap: 6px;
    align-items: end;
  }
  .erb-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .erb-field-stub { opacity: 0.6; }
  .erb-stub {
    padding: 6px 8px;
    background: var(--bg); border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    color: var(--text-ghost); text-align: center;
  }
  .erb-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }

  .erb-rule-rm {
    background: transparent; color: var(--text-muted);
    border: 1px solid var(--card-border);
    cursor: pointer;
    height: 28px;
  }
  .erb-rule-rm:hover { color: var(--status-error, #c0392b); }

  .erb-add {
    align-self: flex-start;
    padding: 4px 10px;
    background: var(--bg); color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .erb-add:hover { color: var(--text-primary); }

  .erb-compiled {
    margin: 0;
    padding: 6px 8px;
    background: color-mix(in srgb, var(--card-border) 16%, transparent);
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    font-family: var(--font-mono); font-size: var(--fs-label);
    white-space: pre-wrap; word-break: break-word;
    max-height: 100px; overflow-y: auto;
  }

  .erb-code {
    width: 100%;
    padding: 8px;
    background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box; outline: none; resize: vertical;
  }
  .erb-code:focus { border-color: var(--text-muted); }

  .erb-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .erb-hint :global(code) { font-size: var(--fs-label); color: var(--text-muted); font-family: var(--font-mono); }

  input[type='text'], select {
    width: 100%; padding: 6px 8px;
    background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border); font: inherit;
    box-sizing: border-box; outline: none;
  }
  input[type='text']:focus, select:focus { border-color: var(--text-muted); }
</style>
