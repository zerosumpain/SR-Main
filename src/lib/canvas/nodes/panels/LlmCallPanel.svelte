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

  // The canvas-level preview header (in /jkai/canvas/[slug]/+page.svelte)
  // already renders the "What this does" line, so we don't duplicate it here.
  void definition;

  // Model dropdown options — sourced from the shared list so all LLM panels
  // stay in lockstep. If new models are added, edit
  // src/lib/canvas/nodes/panels/shared/vertex-models.ts.
  const MODEL_OPTIONS = VERTEX_MODEL_OPTIONS;

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Derived values ----------------------------------------------

  const model = $derived(String(config.model ?? ''));
  const systemPrompt = $derived(String(config.systemPrompt ?? ''));
  const userPrompt = $derived(String(config.userPrompt ?? ''));
  const temperature = $derived.by(() => {
    const raw = config.temperature;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(2, n));
    return 0.7;
  });
  const maxTokens = $derived.by(() => {
    const raw = config.maxTokens;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    return 1024;
  });

  // Temperature descriptor — single-word label that follows the slider live.
  // Thresholds:
  //   <= 0.3  → Focused   (deterministic / near-deterministic)
  //   <= 1.0  → Balanced  (default 0.7 lands here)
  //   <  1.5  → Adventurous
  //   >= 1.5  → Creative  (per spec)
  const tempDescriptor = $derived.by(() => {
    if (temperature <= 0.3) return 'Focused';
    if (temperature <= 1.0) return 'Balanced';
    if (temperature < 1.5) return 'Adventurous';
    return 'Creative';
  });

  // Whether the chosen model is a custom (non-listed) value — the orchestrator
  // sometimes writes IDs we haven't enumerated. Show them in a dim hint instead
  // of silently swapping to "Default".
  const modelInList = $derived(MODEL_OPTIONS.some((o) => o.value === model));

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);
</script>

<div class="lc">
  <!-- User prompt (most-used, first) -->
  <section class="lc-sec">
    <label class="lc-field">
      <span class="lc-label">User Prompt — what you want the model to do</span>
      <TemplatedTextarea
        class="lc-code"
        rows={6}
        spellcheck={false}
        placeholder={`Summarise this text: {{input.text}}`}
        value={userPrompt}
        upstreamFields={upstreamFields}
        onChange={(v) => set('userPrompt', v)}
      />
      <span class="lc-hint">
        Required. Templates supported: <code>{`{{input.field}}`}</code>.
        {#if !userPrompt.trim()}<span class="lc-warn">empty — workflow will fail at runtime</span>{/if}
      </span>
    </label>
  </section>

  <!-- System prompt -->
  <section class="lc-sec">
    <label class="lc-field">
      <span class="lc-label">System Prompt — sets the model's role/voice (optional)</span>
      <TemplatedTextarea
        class="lc-code"
        rows={4}
        spellcheck={false}
        placeholder="You are a helpful assistant that writes concise summaries."
        value={systemPrompt}
        upstreamFields={upstreamFields}
        onChange={(v) => set('systemPrompt', v)}
      />
      <span class="lc-hint">Templates supported: <code>{`{{input.field}}`}</code>. Leave blank to skip the system message.</span>
    </label>
  </section>

  <!-- Model -->
  <section class="lc-sec">
    <label class="lc-field">
      <span class="lc-label">Model</span>
      <select value={model} onchange={(e) => set('model', (e.currentTarget as HTMLSelectElement).value)}>
        {#if !modelInList}
          <option value={model}>Custom: {model}</option>
        {/if}
        {#each MODEL_OPTIONS as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      <span class="lc-hint">Leave on Default to use the admin-configured site default. Slashed IDs (e.g. <code>openai/gpt-4o</code>) route via OpenRouter.</span>
    </label>
  </section>

  <!-- Temperature -->
  <section class="lc-sec">
    <div class="lc-field">
      <div class="lc-temp-hdr">
        <span class="lc-label">Temperature</span>
        <span class="lc-temp-readout">
          <span class="lc-temp-value">{temperature.toFixed(1)}</span>
          <span class="lc-temp-word">{tempDescriptor}</span>
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="2"
        step="0.1"
        value={temperature}
        oninput={(e) => set('temperature', Number((e.currentTarget as HTMLInputElement).value))}
        class="lc-range"
      />
      <span class="lc-hint">0 = focused / deterministic · 0.7 = balanced (default) · 1.5+ = creative.</span>
    </div>
  </section>

  <!-- Max tokens -->
  <section class="lc-sec">
    <label class="lc-field lc-field-narrow">
      <span class="lc-label">Max Tokens</span>
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
      <span class="lc-hint">Maximum length of the AI response (roughly 4 characters per token). Default 1024.</span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="lc-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="lc-code"
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
  .lc { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .lc-sec { display: flex; flex-direction: column; gap: 8px; }

  .lc-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .lc-field-narrow { max-width: 220px; }
  .lc-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .lc-hint { font-size: 11px; color: var(--text-ghost); }
  .lc-hint code, .lc-label code { font-size: 11px; color: var(--text-muted); }

  .lc-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
    margin-left: 6px;
  }

  .lc-temp-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  }
  .lc-temp-readout {
    display: inline-flex; gap: 8px; align-items: baseline;
    font-family: var(--font-mono); font-size: 11px;
  }
  .lc-temp-value { color: var(--text-primary); }
  .lc-temp-word {
    color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px;
  }

  .lc-range {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .lc-code {
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
  .lc-code:focus { border-color: var(--text-muted); }

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

  .lc-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .lc-raw summary { cursor: pointer; }
</style>
