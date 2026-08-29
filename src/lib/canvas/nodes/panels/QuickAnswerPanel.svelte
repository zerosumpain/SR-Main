<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import TemplatedTextarea from './shared/TemplatedTextarea.svelte';

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

  // ---------- Topic (templated) -------------------------------------------
  // Stored as a string in `config.topic`. The executor template-interpolates
  // it against the input record before kicking off the worker.

  const topic = $derived(String(config.topic ?? ''));

  // ---------- Goals -------------------------------------------------------
  // Executor expects `config.goals` as a string[]. We let the user edit it as
  // a multi-line textarea (one goal per line) but keep the array shape so the
  // executor is happy.

  function parseGoals(raw: unknown): string[] {
    if (Array.isArray(raw)) return (raw as unknown[]).map((g) => String(g));
    if (typeof raw === 'string') {
      return raw.split('\n').map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }
  function goalsToText(arr: string[]): string {
    return arr.join('\n');
  }

  const goals = $derived(parseGoals(config.goals));
  const goalsText = $derived(goalsToText(goals));

  function setGoalsText(text: string) {
    // Preserve trailing newlines while typing — store the raw lines as the
    // array, but only commit non-empty entries.
    const arr = text.split('\n').map((s) => s.trim()).filter(Boolean);
    onChange({ ...config, goals: arr });
  }

  // ---------- Polling / wait ---------------------------------------------

  const pollIntervalMs = $derived(Number(config.pollIntervalMs ?? 1500));
  const maxWaitMs = $derived(Number(config.maxWaitMs ?? 180_000));

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Raw JSON ----------------------------------------------------

  let showRawJson = $state(false);

  void definition;
</script>

<div class="qa">
  <!-- Topic -->
  <section class="qa-sec">
    <header class="qa-sec-hdr">
      <span class="sr-label-tight">Topic</span>
    </header>
    <label class="qa-field">
      <span class="qa-label">What to research</span>
      <TemplatedTextarea
        class="qa-code"
        rows={3}
        spellcheck={false}
        placeholder={'What is the impact of {{input.subject}} on …'}
        value={topic}
        upstreamFields={upstreamFields}
        onChange={(v) => set('topic', v)}
      />
      <span class="qa-hint">Required. Templates supported: <code>{`{{input.field}}`}</code> or <code>{`{{item.title}}`}</code>.</span>
    </label>
  </section>

  <!-- Goals -->
  <section class="qa-sec">
    <header class="qa-sec-hdr">
      <span class="sr-label-tight">Goals</span>
      <span class="qa-sec-meta">{goals.length} {goals.length === 1 ? 'goal' : 'goals'}</span>
    </header>
    <label class="qa-field">
      <span class="qa-label">One per line (optional)</span>
      <TemplatedTextarea
        class="qa-code"
        rows={4}
        spellcheck={false}
        placeholder={'Understand key players\nIdentify risks\nList opportunities'}
        value={goalsText}
        upstreamFields={upstreamFields}
        onChange={(v) => setGoalsText(v)}
      />
      <span class="qa-hint">Specific angles or sub-questions. Each line is template-interpolated.</span>
    </label>
  </section>

  <!-- Timing -->
  <section class="qa-sec">
    <header class="qa-sec-hdr">
      <span class="sr-label-tight">Timing</span>
    </header>
    <div class="qa-row">
      <label class="qa-field qa-field-half">
        <span class="qa-label">Poll interval (ms)</span>
        <input
          type="number" min="250" step="250"
          value={pollIntervalMs}
          oninput={(e) => set('pollIntervalMs', Math.max(250, Number((e.currentTarget as HTMLInputElement).value) || 1500))}
        />
      </label>
      <label class="qa-field qa-field-half">
        <span class="qa-label">Max wait (ms)</span>
        <input
          type="number" min="1000" step="1000"
          value={maxWaitMs}
          oninput={(e) => set('maxWaitMs', Math.max(1000, Number((e.currentTarget as HTMLInputElement).value) || 180000))}
        />
      </label>
    </div>
    <span class="qa-hint">Defaults: poll every 1.5s for up to 3 minutes.</span>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="qa-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="qa-code"
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
  .qa { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .qa-sec { display: flex; flex-direction: column; gap: 8px; }
  .qa-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .qa-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .qa-row { display: flex; gap: 10px; }
  .qa-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .qa-field-half { flex: 1; }
  .qa-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .qa-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .qa-hint code { font-size: var(--fs-label); color: var(--text-muted); }

  .qa-code {
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
  .qa-code:focus { border-color: var(--text-muted); }

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
  input[type='text']:focus, input[type='number']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .qa-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .qa-raw summary { cursor: pointer; }
</style>
