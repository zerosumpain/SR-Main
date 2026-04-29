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

  // Model dropdown options — kept in sync with src/lib/workflows/nodes/llm-call.def.ts.
  // If new models are added there, mirror them here.
  const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '', label: 'Default (site setting)' },
    { value: 'glm-5-turbo', label: 'GLM 5 Turbo — Z.AI' },
    { value: 'glm-5.1', label: 'GLM 5.1 — Z.AI' },
    { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
    { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
    { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (fast)' },
    { value: 'google/gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
    { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  ];

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
      <textarea
        class="lc-code"
        rows="6"
        spellcheck="false"
        placeholder={`Summarise this text: {{input.text}}`}
        value={userPrompt}
        oninput={(e) => set('userPrompt', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
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
      <textarea
        class="lc-code"
        rows="4"
        spellcheck="false"
        placeholder="You are a helpful assistant that writes concise summaries."
        value={systemPrompt}
        oninput={(e) => set('systemPrompt', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
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
