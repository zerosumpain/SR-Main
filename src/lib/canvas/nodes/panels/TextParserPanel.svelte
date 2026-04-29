<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import UpstreamFieldPicker from './shared/UpstreamFieldPicker.svelte';

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

  // The executor at src/lib/workflows/nodes/text-parser.ts supports three
  // operations under the `mode` key:
  //   - 'json'   → extract JSON from raw text / markdown ```json``` block /
  //                first {...} or [...] substring
  //   - 'regex'  → run RegExp(pattern, flags), expose match / groups /
  //                allMatches (when `g` flag is set)
  //   - 'split'  → split on `delimiter`, drop empty trimmed segments
  // We mirror those exact keys here. Field names also match the def:
  //   inputField (dot/path-ish), pattern, flags, delimiter.

  type Mode = 'json' | 'regex' | 'split';
  const MODES: Array<{ value: Mode; label: string }> = [
    { value: 'json',  label: 'Extract JSON' },
    { value: 'regex', label: 'Regex match' },
    { value: 'split', label: 'Split by delimiter' },
  ];

  const mode = $derived<Mode>(((): Mode => {
    const m = String(config.mode ?? 'json');
    return m === 'json' || m === 'regex' || m === 'split' ? m : 'json';
  })());
  const inputField = $derived(String(config.inputField ?? 'response'));
  const pattern    = $derived(String(config.pattern ?? ''));
  const flags      = $derived(String(config.flags ?? ''));
  const delimiter  = $derived(config.delimiter !== undefined ? String(config.delimiter) : '\n');

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // Regex compile validation surfaced under the pattern field.
  const regexValid = $derived.by(() => {
    if (mode !== 'regex' || !pattern) return null as null | true | false;
    try { new RegExp(pattern, flags); return true; } catch { return false; }
  });

  // ---------- Test mini-runner ------------------------------------------
  // Independent of the executor module — we re-implement each mode inline
  // so the panel stays decoupled. Every evaluation is wrapped in try/catch.

  let sample = $state<string>('');
  let testResult = $state<{ ok: boolean; payload: unknown } | null>(null);

  function runTest() {
    try {
      if (mode === 'json') {
        // Mirror executor: direct parse → ```json``` block → first {...}/[...].
        let parsed: unknown = undefined;
        try { parsed = JSON.parse(sample); } catch { /* fall through */ }
        if (parsed === undefined) {
          const md = sample.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
          if (md) {
            try { parsed = JSON.parse(md[1].trim()); } catch { /* fall through */ }
          }
        }
        if (parsed === undefined) {
          const obj = sample.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
          if (obj) {
            try { parsed = JSON.parse(obj[1]); } catch { /* fall through */ }
          }
        }
        if (parsed === undefined) {
          testResult = { ok: false, payload: 'No valid JSON found in sample.' };
        } else {
          testResult = { ok: true, payload: parsed };
        }
        return;
      }

      if (mode === 'regex') {
        if (!pattern) {
          testResult = { ok: false, payload: 'No pattern provided.' };
          return;
        }
        const re = new RegExp(pattern, flags);
        const first = re.exec(sample);
        const match = first ? first[0] : null;
        const groups = first?.groups ?? (first ? first.slice(1) : null);
        let allMatches: string[] = [];
        if (flags.includes('g')) {
          const gre = new RegExp(pattern, flags);
          allMatches = Array.from(sample.matchAll(gre), (m) => m[0]);
        } else if (first) {
          allMatches = [first[0]];
        }
        testResult = { ok: !!first, payload: { match, groups, allMatches } };
        return;
      }

      if (mode === 'split') {
        // Allow the user to type the literal escape `\n` / `\t` for
        // delimiters, matching the placeholder hint in the def.
        const delim = delimiter
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r');
        const items = sample.split(delim).filter((s) => s.trim() !== '');
        testResult = { ok: true, payload: { items, count: items.length } };
        return;
      }

      testResult = { ok: false, payload: `Unknown mode: ${mode}` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      testResult = { ok: false, payload: message };
    }
  }

  function clearTest() {
    testResult = null;
  }

  function previewText(payload: unknown): string {
    if (typeof payload === 'string') return payload;
    try { return JSON.stringify(payload, null, 2); } catch { return String(payload); }
  }

  // ---------- Raw JSON disclosure ---------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header handles "What this does" so we don't duplicate it here.
  void definition;
</script>

<div class="tp">
  <!-- Source field + mode -->
  <section class="tp-sec">
    <div class="tp-row tp-mode-row">
      <label class="tp-field tp-field-mode">
        <span class="tp-label">Operation</span>
        <select value={mode} onchange={(e) => set('mode', (e.currentTarget as HTMLSelectElement).value)}>
          {#each MODES as m (m.value)}
            <option value={m.value}>{m.label}</option>
          {/each}
        </select>
      </label>
      <label class="tp-field tp-field-source">
        <UpstreamFieldPicker
          label="Source field"
          value={inputField}
          upstreamFields={upstreamFields}
          placeholder="pick the field to parse"
          allowCustom={true}
          onChange={(v) => set('inputField', v)}
        />
        <span class="tp-hint">Reads <code>input.{inputField || 'response'}</code> from the upstream node.</span>
      </label>
    </div>
  </section>

  <!-- Operation-specific controls -->
  {#if mode === 'json'}
    <section class="tp-sec">
      <header class="tp-sec-hdr"><span class="sr-label-tight">JSON extraction</span></header>
      <p class="tp-empty">
        Tries (in order): direct <code>JSON.parse</code>, fenced
        <code>```json</code> block, then the first <code>&#123;…&#125;</code> /
        <code>[…]</code> substring. No extra options.
      </p>
    </section>
  {:else if mode === 'regex'}
    <section class="tp-sec">
      <header class="tp-sec-hdr">
        <span class="sr-label-tight">Regex</span>
        {#if regexValid === false}<span class="tp-warn">pattern won't compile</span>{/if}
        {#if regexValid === true}<span class="tp-ok">pattern OK</span>{/if}
      </header>
      <label class="tp-field">
        <span class="tp-label">Pattern</span>
        <input
          type="text"
          spellcheck="false"
          placeholder={'score:\\s*(\\d+)'}
          value={pattern}
          oninput={(e) => set('pattern', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="tp-hint">JS regex syntax — backslashes are literal here (no surrounding <code>/.../</code>).</span>
      </label>
      <label class="tp-field">
        <span class="tp-label">Flags</span>
        <input
          type="text"
          spellcheck="false"
          placeholder="gi"
          value={flags}
          oninput={(e) => set('flags', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="tp-hint">e.g. <code>g</code> for all matches, <code>i</code> case-insensitive, <code>m</code> multiline.</span>
      </label>
    </section>
  {:else if mode === 'split'}
    <section class="tp-sec">
      <header class="tp-sec-hdr"><span class="sr-label-tight">Split</span></header>
      <label class="tp-field">
        <span class="tp-label">Delimiter</span>
        <input
          type="text"
          spellcheck="false"
          placeholder={'\\n'}
          value={delimiter}
          oninput={(e) => set('delimiter', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="tp-hint">Use <code>\n</code> for newline, <code>\t</code> for tab. Empty trimmed segments are dropped.</span>
      </label>
    </section>
  {/if}

  <!-- Test mini-runner -->
  <section class="tp-sec">
    <header class="tp-sec-hdr">
      <span class="sr-label-tight">Test</span>
      <span class="tp-sec-meta">{mode}</span>
    </header>
    <textarea
      class="tp-code"
      rows="5"
      spellcheck="false"
      placeholder={
        mode === 'json'
          ? '{"answer":42} or ```json\\n{...}\\n```'
          : mode === 'regex'
          ? 'paste sample text to match against'
          : 'line one\\nline two\\nline three'
      }
      value={sample}
      oninput={(e) => { sample = (e.currentTarget as HTMLTextAreaElement).value; }}
    ></textarea>
    <div class="tp-test-row">
      <button type="button" class="tp-test-btn" onclick={runTest}>Test</button>
      <button type="button" class="tp-test-clear" onclick={clearTest} disabled={testResult === null}>Clear</button>
      {#if testResult}
        <span class="tp-result-chip" class:tp-result-ok={testResult.ok} class:tp-result-bad={!testResult.ok}>
          {testResult.ok ? 'matched' : 'no result'}
        </span>
      {/if}
    </div>
    {#if testResult}
      <pre class="tp-result-preview">{previewText(testResult.payload)}</pre>
    {/if}
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="tp-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="tp-code"
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
  .tp { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .tp-sec { display: flex; flex-direction: column; gap: 8px; }
  .tp-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .tp-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }

  .tp-row { display: flex; gap: 10px; }
  .tp-mode-row { align-items: flex-end; }
  .tp-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .tp-field-mode   { flex: 0 0 170px; }
  .tp-field-source { flex: 1; }
  .tp-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .tp-hint { font-size: 11px; color: var(--text-ghost); }
  .tp-hint code, .tp-label code { font-size: 11px; color: var(--text-muted); }

  .tp-empty { margin: 0; font-size: 12px; color: var(--text-ghost); line-height: 1.5; }
  .tp-empty code { font-size: 11px; color: var(--text-muted); }

  .tp-code {
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
  .tp-code:focus { border-color: var(--text-muted); }

  .tp-test-row { display: flex; align-items: center; gap: 8px; }
  .tp-test-btn {
    padding: 5px 12px;
    background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    cursor: pointer;
  }
  .tp-test-btn:hover { border-color: var(--text-muted); }
  .tp-test-clear {
    padding: 5px 10px;
    background: transparent; color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    cursor: pointer;
  }
  .tp-test-clear:disabled { opacity: 0.4; cursor: default; }
  .tp-test-clear:not(:disabled):hover { color: var(--text-primary); }

  .tp-result-chip {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    padding: 2px 6px;
    border: 1px solid var(--card-border);
  }
  .tp-result-ok  { color: var(--status-success, #2a9d4a); border-color: color-mix(in srgb, var(--status-success, #2a9d4a) 50%, var(--card-border)); }
  .tp-result-bad { color: var(--status-error, #c0392b); border-color: color-mix(in srgb, var(--status-error, #c0392b) 50%, var(--card-border)); }

  .tp-result-preview {
    margin: 0;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow: auto;
  }

  .tp-warn { font-family: var(--font-mono); font-size: 10px; color: var(--status-error, #c0392b); }
  .tp-ok   { font-family: var(--font-mono); font-size: 10px; color: var(--status-success, #2a9d4a); }

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

  .tp-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .tp-raw summary { cursor: pointer; }
</style>
