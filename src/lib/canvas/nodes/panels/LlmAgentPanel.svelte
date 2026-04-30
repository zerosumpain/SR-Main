<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import TemplatedTextarea from './shared/TemplatedTextarea.svelte';
  import { VERTEX_MODEL_OPTIONS } from './shared/vertex-models';

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

  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;

  // ---------- Model dropdown options --------------------------------------
  // Sourced from the shared list so all LLM panels stay in lockstep. If new
  // models are added, edit src/lib/canvas/nodes/panels/shared/vertex-models.ts.
  const MODEL_OPTIONS = VERTEX_MODEL_OPTIONS;
  const currentModel = $derived(String(config.model ?? ''));
  const modelInList = $derived(MODEL_OPTIONS.some((o) => o.value === currentModel));

  // ---------- Generic setter ----------------------------------------------

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Numeric setters with sane fallbacks --------------------------

  function setNumber(key: string, raw: string, fallback: number, min?: number) {
    const parsed = Number(raw);
    let next = Number.isFinite(parsed) ? parsed : fallback;
    if (typeof min === 'number' && next < min) next = min;
    set(key, next);
  }

  // ---------- Temperature derived state -----------------------------------

  const temperature = $derived(Number(config.temperature ?? 0.7));
  const tempDescriptor = $derived.by(() => {
    if (temperature <= 0.2) return 'Focused';
    if (temperature <= 0.9) return 'Balanced';
    if (temperature < 1.5) return 'Exploratory';
    return 'Creative';
  });

  // ---------- Tool overrides handling -------------------------------------
  // The orchestrator may store `toolOverrides` either as a JSON string or as
  // an object literal. Mirror parseHeaders/headersAreValid from
  // HttpRequestPanel: render a textarea with the stringified shape, and a
  // small validity chip beside the label.

  function toolOverridesToString(raw: unknown): string {
    if (raw == null) return '';
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object') {
      try { return JSON.stringify(raw, null, 2); } catch { return ''; }
    }
    return '';
  }

  const toolOverridesText = $derived(toolOverridesToString(config.toolOverrides));
  const toolOverridesValid = $derived.by(() => {
    const raw = config.toolOverrides;
    if (raw == null) return true;
    if (typeof raw === 'object') return true;
    if (typeof raw === 'string') {
      if (!raw.trim()) return true;
      try {
        const obj = JSON.parse(raw);
        return obj != null && typeof obj === 'object' && !Array.isArray(obj);
      } catch { return false; }
    }
    return false;
  });

  function setToolOverrides(text: string) {
    // Always store as string — the executor parses both shapes anyway, but
    // serialising as a string keeps the workflow JSON stable and round-trips
    // cleanly through the raw-JSON editor.
    set('toolOverrides', text);
  }

  // ---------- Raw JSON disclosure -----------------------------------------

  let showRawJson = $state(false);
</script>

<div class="la">
  <!-- Section 1: Prompt & model -->
  <section class="la-sec">
    <header class="la-sec-hdr"><span class="sr-label-tight">Prompt &amp; model</span></header>

    <label class="la-field">
      <span class="la-label">User prompt <span class="la-req">required</span></span>
      <TemplatedTextarea
        class="la-code"
        rows={5}
        spellcheck={false}
        placeholder={`{{input.query}}`}
        value={String(config.userPrompt ?? '')}
        upstreamFields={upstreamFields}
        onChange={(v) => set('userPrompt', v)}
      />
      <span class="la-hint">
        The main instruction for the agent. Templates supported:
        <code>{`{{input.field}}`}</code>.
      </span>
    </label>

    <label class="la-field">
      <span class="la-label">System prompt <span class="la-opt">optional</span></span>
      <TemplatedTextarea
        class="la-code"
        rows={4}
        spellcheck={false}
        placeholder="You are a helpful assistant..."
        value={String(config.systemPrompt ?? '')}
        upstreamFields={upstreamFields}
        onChange={(v) => set('systemPrompt', v)}
      />
      <span class="la-hint">
        Sets the agent's role and behaviour. Templates supported.
      </span>
    </label>

    <label class="la-field">
      <span class="la-label">Model</span>
      <select
        value={currentModel}
        onchange={(e) => set('model', (e.currentTarget as HTMLSelectElement).value)}
      >
        {#each MODEL_OPTIONS as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
        {#if !modelInList && currentModel}
          <option value={currentModel}>Custom: {currentModel}</option>
        {/if}
      </select>
      <span class="la-hint">
        Leave as <strong>Default</strong> to use the site-wide admin setting (recommended).
        Slashed IDs route via OpenRouter and require a key.
      </span>
    </label>

    <label class="la-field">
      <span class="la-label">
        Temperature
        <span class="la-temp-readout">{temperature.toFixed(1)} · {tempDescriptor}</span>
      </span>
      <input
        type="range"
        min="0"
        max="2"
        step="0.1"
        class="la-slider"
        value={temperature}
        oninput={(e) => set('temperature', Number((e.currentTarget as HTMLInputElement).value))}
      />
      <span class="la-hint la-temp-scale">
        <span>0 · Focused</span><span>0.7 · Balanced</span><span>1.5+ · Creative</span>
      </span>
    </label>
  </section>

  <!-- Section 2: Loop limits & timeouts (collapsed by default) -->
  <details class="la-collapsible">
    <summary><span class="sr-label-tight">Loop limits &amp; timeouts</span></summary>
    <div class="la-sec la-sec-inner">
      <div class="la-row">
        <label class="la-field">
          <span class="la-label">Max tokens per call</span>
          <input
            type="number"
            min="1"
            step="1"
            value={Number(config.maxTokens ?? 2048)}
            oninput={(e) => setNumber('maxTokens', (e.currentTarget as HTMLInputElement).value, 2048, 1)}
          />
          <span class="la-hint">Cap on each individual LLM response length.</span>
        </label>
        <label class="la-field">
          <span class="la-label">Max iterations</span>
          <input
            type="number"
            min="1"
            step="1"
            value={Number(config.maxIterations ?? 10)}
            oninput={(e) => setNumber('maxIterations', (e.currentTarget as HTMLInputElement).value, 10, 1)}
          />
          <span class="la-hint">
            How many tool-call rounds the agent may run before giving up.
          </span>
        </label>
      </div>

      <div class="la-row">
        <label class="la-field">
          <span class="la-label">Max total tokens</span>
          <input
            type="number"
            min="0"
            step="1"
            value={Number(config.maxTotalTokens ?? 0)}
            oninput={(e) => setNumber('maxTotalTokens', (e.currentTarget as HTMLInputElement).value, 0, 0)}
          />
          <span class="la-hint">
            <code>0</code> = unlimited; otherwise stops once cumulative LLM
            usage hits this many tokens.
          </span>
        </label>
        <label class="la-field">
          <span class="la-label">Timeout (ms)</span>
          <input
            type="number"
            min="0"
            step="100"
            value={Number(config.timeoutMs ?? 0)}
            oninput={(e) => setNumber('timeoutMs', (e.currentTarget as HTMLInputElement).value, 0, 0)}
          />
          <span class="la-hint"><code>0</code> = no wall-clock cap.</span>
        </label>
      </div>
    </div>
  </details>

  <!-- Section 3: Tool overrides (collapsed by default) -->
  <details class="la-collapsible">
    <summary><span class="sr-label-tight">Tool overrides</span></summary>
    <div class="la-sec la-sec-inner">
      <p class="la-explain">
        The agent automatically uses every <em>downstream</em> connected node as
        a tool. This optional JSON map lets you rename a tool or rewrite its
        description so the agent picks the right one. Format:
        <code>{`{ "<nodeId>": { "name": "...", "description": "..." } }`}</code>.
      </p>
      <label class="la-field">
        <span class="la-label">
          Overrides JSON
          {#if toolOverridesValid}
            <span class="la-ok">JSON ✓</span>
          {:else}
            <span class="la-warn">not valid JSON</span>
          {/if}
        </span>
        <textarea
          class="la-code"
          rows="6"
          spellcheck="false"
          placeholder={`{
  "node-uuid-here": {
    "name": "search_docs",
    "description": "Search the docs index for matching pages."
  }
}`}
          value={toolOverridesText}
          oninput={(e) => setToolOverrides((e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="la-hint">
          Node IDs are opaque UUIDs — copy them from the node header in the
          canvas. Leave blank to use defaults.
        </span>
      </label>
    </div>
  </details>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="la-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="la-code"
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
  .la { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .la-sec { display: flex; flex-direction: column; gap: 10px; }
  .la-sec-inner { padding-top: 6px; }
  .la-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .la-row { display: flex; gap: 10px; }
  .la-row .la-field { flex: 1; min-width: 0; }

  .la-field { display: flex; flex-direction: column; gap: 4px; }
  .la-label {
    display: flex; align-items: center; gap: 8px;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .la-req {
    font-family: var(--font-mono); font-size: 9px;
    color: var(--status-error, #c0392b);
    text-transform: uppercase; letter-spacing: 0.08em;
  }
  .la-opt {
    font-family: var(--font-mono); font-size: 9px;
    color: var(--text-ghost);
    text-transform: uppercase; letter-spacing: 0.08em;
  }

  .la-hint { font-size: 11px; color: var(--text-ghost); }
  .la-hint code, .la-label code { font-size: 11px; color: var(--text-muted); }
  .la-explain {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .la-explain code { font-size: 11px; color: var(--text-primary); }

  .la-code {
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
  .la-code:focus { border-color: var(--text-muted); }

  .la-slider {
    width: 100%;
    padding: 0;
    background: transparent;
    border: none;
    accent-color: var(--accent);
  }
  .la-temp-readout {
    margin-left: auto;
    font-family: var(--font-mono); font-size: 11px;
    color: var(--accent);
    text-transform: none; letter-spacing: 0;
  }
  .la-temp-scale {
    display: flex; justify-content: space-between;
    font-family: var(--font-mono); font-size: 10px;
  }

  .la-warn { font-family: var(--font-mono); font-size: 10px; color: var(--status-error, #c0392b); }
  .la-ok   { font-family: var(--font-mono); font-size: 10px; color: var(--status-success, #2a9d4a); }

  .la-collapsible {
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--card-border) 8%, transparent);
    padding: 8px 10px;
  }
  .la-collapsible > summary {
    cursor: pointer;
    list-style: none;
  }
  .la-collapsible > summary::-webkit-details-marker { display: none; }
  .la-collapsible > summary::before {
    content: '▸';
    display: inline-block;
    margin-right: 6px;
    font-size: 10px;
    color: var(--text-muted);
    transition: transform 0.15s;
  }
  .la-collapsible[open] > summary::before {
    transform: rotate(90deg);
  }

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
  input[type='text']:focus, input[type='number']:focus, select:focus, textarea:focus {
    border-color: var(--text-muted);
  }

  .la-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .la-raw summary { cursor: pointer; }
</style>
