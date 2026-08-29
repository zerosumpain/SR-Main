<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ModelSelect from './widgets/ModelSelect.svelte';
  import TemperatureField from './widgets/TemperatureField.svelte';
  import MaxTokensField from './widgets/MaxTokensField.svelte';
  import { DEFAULT_NODE_MAX_TOKENS } from '$lib/constants/default-models';

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

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // Fetch the live OpenRouter model catalogue from /api/admin/models/openrouter.
  // The endpoint returns paginated rows; we pull a generous page size and
  // sort by id so the alphabetised list groups by provider naturally.
  async function fetchOpenRouterModels(): Promise<Array<{ value: string; label: string; meta?: string }>> {
    const res = await fetch('/api/admin/models/openrouter?pageSize=100&sortBy=id&sortDir=asc');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as {
      rows: Array<{ id: string; name: string; provider: string | null; contextLength: number | null }>;
    };
    return data.rows.map((r) => ({
      value: r.id,
      label: r.name || r.id,
      meta: r.provider ?? undefined,
    }));
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
    return DEFAULT_NODE_MAX_TOKENS;
  });

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

    <ModelSelect
      value={model}
      onChange={(v) => set('model', v)}
      fetcher={fetchOpenRouterModels}
      placeholder="pick an OpenRouter model"
      emptyHint="No OpenRouter models cached — refresh from /admin/ai/models or type a slashed ID."
      hint="Loaded live from the OpenRouter catalogue. Leave blank to use the admin-configured alt model. All IDs are slashed <code>provider/model</code> values."
    />

    <TemperatureField
      value={temperature}
      onChange={(v) => set('temperature', v)}
    />

    <MaxTokensField
      value={maxTokens}
      onChange={(v) => set('maxTokens', v)}
    />
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
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .or-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .or-hint code, .or-label code { font-size: var(--fs-label); color: var(--text-muted); }

  .or-warn {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
    margin-left: 6px;
  }

  .or-temp-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  }
  .or-temp-readout {
    display: inline-flex; gap: 8px; align-items: baseline;
    font-family: var(--font-mono); font-size: var(--fs-label);
  }
  .or-temp-value { color: var(--text-primary); }
  .or-temp-word {
    color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.06em; font-size: var(--fs-label-xs);
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
    font-family: var(--font-code); font-size: var(--fs-label);
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
