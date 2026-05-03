<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import TemplatedTextarea from './shared/TemplatedTextarea.svelte';
  import ModelSelect from './widgets/ModelSelect.svelte';
  import TemperatureField from './widgets/TemperatureField.svelte';
  import MaxTokensField from './widgets/MaxTokensField.svelte';
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

  <ModelSelect
    value={model}
    onChange={(v) => set('model', v)}
    options={VERTEX_MODEL_OPTIONS}
    hint="Leave on Default to use the admin-configured site default. Slashed IDs (e.g. <code>openai/gpt-4o</code>) route via OpenRouter."
  />

  <TemperatureField
    value={temperature}
    onChange={(v) => set('temperature', v)}
  />

  <MaxTokensField
    value={maxTokens}
    onChange={(v) => set('maxTokens', v)}
    hint="Maximum length of the AI response (roughly 4 characters per token). Default 1024."
  />

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
