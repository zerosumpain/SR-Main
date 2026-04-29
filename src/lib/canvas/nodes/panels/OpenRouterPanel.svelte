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

  // Per spec: do not duplicate the canvas-level "What this does" preview header.
  void definition;

  // Operation choices — mirrors openrouter.def.ts.
  const OPERATIONS: Array<{ value: string; label: string; hint: string }> = [
    { value: 'chat_completion', label: 'Chat Completion', hint: 'Run a prompt through an OpenRouter-hosted model.' },
    { value: 'list_models', label: 'List Models', hint: 'Return the catalogue of OpenRouter models for the API key.' },
    { value: 'get_usage', label: 'Get API Usage', hint: 'Return current usage / limits for the OpenRouter key.' },
  ];

  // Model dropdown — kept in sync with src/lib/workflows/nodes/openrouter.def.ts.
  // OpenRouter routes via slashed IDs (provider/model). Empty value falls back
  // to the admin-configured chat-alt OpenRouter model at runtime.
  const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '', label: 'Default (use admin alt OpenRouter model)' },
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

  const operation = $derived(String(config.operation ?? 'chat_completion'));
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

  // Single-word descriptor that follows the temperature slider live.
  // Same thresholds as LlmCallPanel for cross-panel consistency.
  const tempDescriptor = $derived.by(() => {
    if (temperature <= 0.3) return 'Focused';
    if (temperature <= 1.0) return 'Balanced';
    if (temperature < 1.5) return 'Adventurous';
    return 'Creative';
  });

  // The orchestrator sometimes writes model IDs we haven't enumerated. Surface
  // them rather than silently snapping to "Default".
  const modelInList = $derived(MODEL_OPTIONS.some((o) => o.value === model));

  const operationHint = $derived(
    OPERATIONS.find((o) => o.value === operation)?.hint ?? '',
  );

  const isChat = $derived(operation === 'chat_completion');

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);
</script>

<div class="or">
  <!-- Operation -->
  <section class="or-sec">
    <label class="or-field">
      <span class="or-label">Action</span>
      <select
        value={operation}
        onchange={(e) => set('operation', (e.currentTarget as HTMLSelectElement).value)}
      >
        {#each OPERATIONS as op (op.value)}
          <option value={op.value}>{op.label}</option>
        {/each}
      </select>
      <span class="or-hint">{operationHint}</span>
    </label>
  </section>

  {#if isChat}
    <!-- User prompt (most-used, first) -->
    <section class="or-sec">
      <label class="or-field">
        <span class="or-label">User Prompt — what you want the model to do</span>
        <textarea
          class="or-code"
          rows="6"
          spellcheck="false"
          placeholder={'Summarise this text: {{input.text}}'}
          value={userPrompt}
          oninput={(e) => set('userPrompt', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="or-hint">
          Required. Templates supported: <code>{`{{input.field}}`}</code>.
          {#if !userPrompt.trim()}<span class="or-warn">empty — workflow will fail at runtime</span>{/if}
        </span>
      </label>
    </section>

    <!-- System prompt -->
    <section class="or-sec">
      <label class="or-field">
        <span class="or-label">System Prompt — sets the model's role/voice (optional)</span>
        <textarea
          class="or-code"
          rows="4"
          spellcheck="false"
          placeholder="You are a helpful assistant that writes concise summaries."
          value={systemPrompt}
          oninput={(e) => set('systemPrompt', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="or-hint">Templates supported: <code>{`{{input.field}}`}</code>. Leave blank to skip the system message.</span>
      </label>
    </section>

    <!-- Model -->
    <section class="or-sec">
      <label class="or-field">
        <span class="or-label">Model</span>
        <select
          value={model}
          onchange={(e) => set('model', (e.currentTarget as HTMLSelectElement).value)}
        >
          {#if !modelInList}
            <option value={model}>Custom: {model}</option>
          {/if}
          {#each MODEL_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
        <span class="or-hint">
          Leave on Default to use the admin-configured OpenRouter alt model. All IDs are slashed
          <code>provider/model</code> values routed through OpenRouter.
        </span>
      </label>
    </section>

    <!-- Temperature -->
    <section class="or-sec">
      <div class="or-field">
        <div class="or-temp-hdr">
          <span class="or-label">Temperature</span>
          <span class="or-temp-readout">
            <span class="or-temp-value">{temperature.toFixed(1)}</span>
            <span class="or-temp-word">{tempDescriptor}</span>
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={temperature}
          oninput={(e) => set('temperature', Number((e.currentTarget as HTMLInputElement).value))}
          class="or-range"
        />
        <span class="or-hint">0 = focused / deterministic · 0.7 = balanced (default) · 1.5+ = creative.</span>
      </div>
    </section>

    <!-- Max tokens -->
    <section class="or-sec">
      <label class="or-field or-field-narrow">
        <span class="or-label">Max Tokens</span>
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
        <span class="or-hint">Maximum length of the AI response (roughly 4 characters per token). Default 1024.</span>
      </label>
    </section>
  {:else}
    <section class="or-sec or-info">
      <span class="or-hint">
        This action takes no extra config. It uses the OpenRouter API key from site settings
        and returns the result on the <code>output</code> port.
      </span>
    </section>
  {/if}

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON (last) -->
  <details class="or-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="or-code"
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
  .or { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .or-sec { display: flex; flex-direction: column; gap: 8px; }
  .or-info { padding: 8px 10px; border: 1px dashed var(--card-border); }

  .or-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .or-field-narrow { max-width: 220px; }
  .or-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .or-hint { font-size: 11px; color: var(--text-ghost); }
  .or-hint code, .or-label code { font-size: 11px; color: var(--text-muted); }

  .or-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
    margin-left: 6px;
  }

  .or-temp-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  }
  .or-temp-readout {
    display: inline-flex; gap: 8px; align-items: baseline;
    font-family: var(--font-mono); font-size: 11px;
  }
  .or-temp-value { color: var(--text-primary); }
  .or-temp-word {
    color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px;
  }

  .or-range {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .or-code {
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
  .or-code:focus { border-color: var(--text-muted); }

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

  .or-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .or-raw summary { cursor: pointer; }
</style>
