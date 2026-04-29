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

  // The canvas-level preview header (in /jkai/canvas/[slug]/+page.svelte)
  // already renders the "What this does" line, so we don't duplicate it here.
  void definition;

  // Model dropdown options — kept in sync with src/lib/workflows/nodes/think.def.ts.
  // If new models are added there, mirror them here.
  const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'glm-5-turbo', label: 'GLM 5 Turbo — Z.AI (jkai default)' },
    { value: 'glm-5.1', label: 'GLM 5.1 — Z.AI' },
    { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
    { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
    { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (smart)' },
    { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4 (very fast)' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ];

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Derived values ----------------------------------------------

  const prompt = $derived(String(config.prompt ?? ''));
  const model = $derived(String(config.model ?? 'glm-5-turbo'));
  const temperature = $derived.by(() => {
    const raw = config.temperature;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(2, n));
    return 0.3;
  });
  const maxTokens = $derived.by(() => {
    const raw = config.maxTokens;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    return 2048;
  });

  // Temperature descriptor — single-word label that follows the slider live.
  // Matches the LlmCallPanel thresholds for visual consistency.
  const tempDescriptor = $derived.by(() => {
    if (temperature <= 0.3) return 'Focused';
    if (temperature <= 1.0) return 'Balanced';
    if (temperature < 1.5) return 'Adventurous';
    return 'Creative';
  });

  // Whether the chosen model is a custom (non-listed) value — the orchestrator
  // sometimes writes IDs we haven't enumerated. Show them as a "Custom" option
  // instead of silently swapping to the default.
  const modelInList = $derived(MODEL_OPTIONS.some((o) => o.value === model));

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);
</script>

<div class="th">
  <!-- Reasoning task (most-used, first) -->
  <section class="th-sec">
    <label class="th-field">
      <span class="th-label">Reasoning Task — what you want the model to think about</span>
      <textarea
        class="th-code"
        rows="6"
        spellcheck="false"
        placeholder={`Analyze {{input.data}} and determine the best course of action.`}
        value={prompt}
        oninput={(e) => set('prompt', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="th-hint">
        Required. Templates supported: <code>{`{{input.field}}`}</code>. The full input is also injected verbatim before the task.
        {#if !prompt.trim()}<span class="th-warn">empty — workflow will fail at runtime</span>{/if}
      </span>
    </label>
  </section>

  <!-- Model -->
  <section class="th-sec">
    <label class="th-field">
      <span class="th-label">Model</span>
      <select value={model} onchange={(e) => set('model', (e.currentTarget as HTMLSelectElement).value)}>
        {#if !modelInList}
          <option value={model}>Custom: {model}</option>
        {/if}
        {#each MODEL_OPTIONS as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      <span class="th-hint">Bare IDs (e.g. <code>glm-5-turbo</code>) route via the jkai default provider. Slashed IDs (e.g. <code>openai/gpt-4o</code>) route via OpenRouter.</span>
    </label>
  </section>

  <!-- Temperature -->
  <section class="th-sec">
    <div class="th-field">
      <div class="th-temp-hdr">
        <span class="th-label">Temperature</span>
        <span class="th-temp-readout">
          <span class="th-temp-value">{temperature.toFixed(1)}</span>
          <span class="th-temp-word">{tempDescriptor}</span>
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="2"
        step="0.1"
        value={temperature}
        oninput={(e) => set('temperature', Number((e.currentTarget as HTMLInputElement).value))}
        class="th-range"
      />
      <span class="th-hint">0 = deterministic reasoning · 0.3 = focused (default for Think) · 1.5+ = creative.</span>
    </div>
  </section>

  <!-- Max tokens -->
  <section class="th-sec">
    <label class="th-field th-field-narrow">
      <span class="th-label">Max Tokens</span>
      <input
        type="number"
        min="1"
        step="1"
        value={maxTokens}
        oninput={(e) => {
          const v = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1));
          set('maxTokens', v);
        }}
      />
      <span class="th-hint">Maximum length of the reasoning + conclusion combined (roughly 4 characters per token). Default 2048.</span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="th-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="th-code"
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
  .th { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .th-sec { display: flex; flex-direction: column; gap: 8px; }

  .th-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .th-field-narrow { max-width: 220px; }
  .th-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .th-hint { font-size: 11px; color: var(--text-ghost); }
  .th-hint code, .th-label code { font-size: 11px; color: var(--text-muted); }

  .th-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
    margin-left: 6px;
  }

  .th-temp-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  }
  .th-temp-readout {
    display: inline-flex; gap: 8px; align-items: baseline;
    font-family: var(--font-mono); font-size: 11px;
  }
  .th-temp-value { color: var(--text-primary); }
  .th-temp-word {
    color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px;
  }

  .th-range {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .th-code {
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
  .th-code:focus { border-color: var(--text-muted); }

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

  .th-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .th-raw summary { cursor: pointer; }
</style>
