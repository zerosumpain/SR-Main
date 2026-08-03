<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import TemplatedTextarea from './shared/TemplatedTextarea.svelte';
  import ModelSelect from './widgets/ModelSelect.svelte';
  import TemperatureField from './widgets/TemperatureField.svelte';
  import MaxTokensField from './widgets/MaxTokensField.svelte';
  import { DEFAULT_NODE_MAX_TOKENS } from '$lib/constants/default-models';
  import { fetchAllChatModels } from './shared/vertex-models';

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

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  const prompt = $derived(String(config.prompt ?? ''));
  const model = $derived(String(config.model ?? ''));
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
    return DEFAULT_NODE_MAX_TOKENS;
  });

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);
</script>

<div class="th">
  <!-- Reasoning task (most-used, first) -->
  <section class="th-sec">
    <label class="th-field">
      <span class="th-label">Reasoning Task — what you want the model to think about</span>
      <TemplatedTextarea
        class="th-code"
        rows={6}
        spellcheck={false}
        placeholder={`Analyze {{input.data}} and determine the best course of action.`}
        value={prompt}
        upstreamFields={upstreamFields}
        onChange={(v) => set('prompt', v)}
      />
      <span class="th-hint">
        Required. Templates supported: <code>{`{{input.field}}`}</code>. The full input is also injected verbatim before the task.
        {#if !prompt.trim()}<span class="th-warn">empty — workflow will fail at runtime</span>{/if}
      </span>
    </label>
  </section>

  <ModelSelect
    value={model}
    onChange={(v) => set('model', v)}
    fetcher={fetchAllChatModels}
    hint="Prefer full OpenRouter slugs (e.g. <code>z-ai/glm-5.2</code>, <code>openai/gpt-4o</code>) — the full live OpenRouter catalogue is in the picker. Bare IDs (e.g. <code>glm-5-turbo</code>) are legacy GLM ids, mapped to their <code>z-ai/*</code> slugs."
  />

  <TemperatureField
    value={temperature}
    onChange={(v) => set('temperature', v)}
    hint="0 = deterministic reasoning · 0.3 = focused (default for Think) · 1.5+ = creative."
  />

  <MaxTokensField
    value={maxTokens}
    onChange={(v) => set('maxTokens', v)}
    hint="Ceiling on the reasoning + conclusion combined (roughly 4 characters per token). Bias high — the reasoning is charged against this budget before a single word of the conclusion is written."
  />

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
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .th-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .th-hint code, .th-label code { font-size: var(--fs-label); color: var(--text-muted); }

  .th-warn {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
    margin-left: 6px;
  }

  .th-temp-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  }
  .th-temp-readout {
    display: inline-flex; gap: 8px; align-items: baseline;
    font-family: var(--font-mono); font-size: var(--fs-label);
  }
  .th-temp-value { color: var(--text-primary); }
  .th-temp-word {
    color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.06em; font-size: var(--fs-label-xs);
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
    font-family: var(--font-mono); font-size: var(--fs-label);
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
