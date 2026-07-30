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

  // Reference for typing only — the canvas-level preview header handles
  // the "what this does" line, so we don't duplicate it inside the panel.
  void definition;

  // ---------- Operation -------------------------------------------------
  // The executor branches on `config.operation`. Supported values:
  //   stats | readiness | sleep | training_load | timeline
  // Anything else short-circuits with "Unknown operation".

  const OPERATIONS = [
    { value: 'stats', label: 'Fitness Stats', blurb: 'HR, steps, active calories, etc.' },
    { value: 'readiness', label: 'Readiness Score', blurb: 'HRV / sleep / training-load composite.' },
    { value: 'sleep', label: 'Sleep Analysis', blurb: 'Duration, stages, quality.' },
    { value: 'training_load', label: 'Training Load', blurb: 'Fitness / fatigue balance.' },
    { value: 'timeline', label: 'Activity Timeline', blurb: 'Paginated recent activities.' },
  ] as const;

  const operation = $derived(String(config.operation ?? 'stats'));
  const opMeta = $derived(OPERATIONS.find((o) => o.value === operation));
  const isTimeline = $derived(operation === 'timeline');

  // ---------- Date range (preset + optional custom) --------------------
  // Stored under `config.range` as a preset id. Custom range stores
  // `config.from` / `config.to` ISO date strings. The executor itself
  // doesn't currently consume these (only `operation`/`page`/`limit`),
  // but we preserve them on the config object so future versions and
  // template interpolation downstream can read them.

  const RANGE_PRESETS = [
    { value: '24h', label: 'Last 24 hours' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: 'ytd', label: 'Year to date' },
    { value: 'all', label: 'All time' },
    { value: 'custom', label: 'Custom range…' },
  ] as const;

  const range = $derived(String(config.range ?? '7d'));
  const fromDate = $derived(String(config.from ?? ''));
  const toDate = $derived(String(config.to ?? ''));

  // ---------- Metrics (chip input) -------------------------------------
  // Free-form chips. Stored as an array of strings under `config.metrics`.
  // Useful primarily for `stats` (filter which metrics come back). Hidden
  // for `timeline` since that operation paginates raw activities instead.

  const metrics = $derived.by<string[]>(() => {
    const raw = config.metrics;
    if (Array.isArray(raw)) return raw.map((m) => String(m)).filter(Boolean);
    if (typeof raw === 'string') {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
  });

  const METRIC_SUGGESTIONS = [
    'heart_rate',
    'hrv',
    'resting_hr',
    'steps',
    'active_calories',
    'distance',
    'sleep_total',
    'sleep_deep',
    'sleep_rem',
    'vo2_max',
  ];

  let metricDraft = $state('');
  const metricsEnabled = $derived(operation !== 'timeline');

  // ---------- Helpers ---------------------------------------------------

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function setMany(patch: Record<string, unknown>) {
    onChange({ ...config, ...patch });
  }

  function commitMetrics(next: string[]) {
    // De-dupe (case-insensitive) while preserving order.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of next) {
      const key = m.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(m.trim());
    }
    set('metrics', out);
  }

  function addMetric(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    commitMetrics([...metrics, trimmed]);
    metricDraft = '';
  }

  function removeMetric(i: number) {
    const next = metrics.slice();
    next.splice(i, 1);
    commitMetrics(next);
  }

  function onMetricKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addMetric(metricDraft);
    } else if (e.key === 'Backspace' && !metricDraft && metrics.length > 0) {
      e.preventDefault();
      removeMetric(metrics.length - 1);
    }
  }

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);
</script>

<div class="hq">
  <!-- Operation -->
  <section class="hq-sec">
    <header class="hq-sec-hdr">
      <span class="sr-label-tight">Query type</span>
      {#if opMeta}<span class="hq-sec-meta">{opMeta.blurb}</span>{/if}
    </header>
    <label class="hq-field">
      <span class="hq-label">Action</span>
      <select
        value={operation}
        onchange={(e) => set('operation', (e.currentTarget as HTMLSelectElement).value)}
      >
        {#each OPERATIONS as op (op.value)}
          <option value={op.value}>{op.label}</option>
        {/each}
      </select>
    </label>
  </section>

  <!-- Date range -->
  <section class="hq-sec">
    <header class="hq-sec-hdr">
      <span class="sr-label-tight">Date range</span>
      <span class="hq-sec-meta">passed through to downstream nodes</span>
    </header>
    <label class="hq-field">
      <span class="hq-label">Preset</span>
      <select
        value={range}
        onchange={(e) => set('range', (e.currentTarget as HTMLSelectElement).value)}
      >
        {#each RANGE_PRESETS as r (r.value)}
          <option value={r.value}>{r.label}</option>
        {/each}
      </select>
    </label>
    {#if range === 'custom'}
      <div class="hq-row">
        <label class="hq-field hq-field-half">
          <span class="hq-label">From</span>
          <input
            type="date"
            value={fromDate}
            oninput={(e) => set('from', (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="hq-field hq-field-half">
          <span class="hq-label">To</span>
          <input
            type="date"
            value={toDate}
            oninput={(e) => set('to', (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>
      <span class="hq-hint">Both bounds are inclusive ISO dates.</span>
    {/if}
  </section>

  <!-- Timeline pagination -->
  {#if isTimeline}
    <section class="hq-sec">
      <header class="hq-sec-hdr">
        <span class="sr-label-tight">Timeline pagination</span>
        <span class="hq-sec-meta">templates supported</span>
      </header>
      <div class="hq-row">
        <label class="hq-field hq-field-half">
          <span class="hq-label">Page</span>
          <input
            type="text"
            spellcheck="false"
            placeholder={'1 or {{input.page}}'}
            value={String(config.page ?? '')}
            oninput={(e) => set('page', (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="hq-field hq-field-half">
          <span class="hq-label">Items per page</span>
          <input
            type="text"
            spellcheck="false"
            placeholder={'20 or {{input.limit}}'}
            value={String(config.limit ?? '')}
            oninput={(e) => set('limit', (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>
      <span class="hq-hint">
        Defaults: page <code>1</code>, limit <code>20</code>. Templates like
        <code>{`{{input.page}}`}</code> are interpolated at run time.
      </span>
    </section>
  {/if}

  <!-- Metrics -->
  {#if metricsEnabled}
    <section class="hq-sec">
      <header class="hq-sec-hdr">
        <span class="sr-label-tight">Metrics filter</span>
        <span class="hq-sec-meta">{metrics.length} {metrics.length === 1 ? 'metric' : 'metrics'}</span>
      </header>
      <div class="hq-chip-input" role="group">
        {#each metrics as m, i (i + ':' + m)}
          <span class="hq-chip">
            <span class="hq-chip-text">{m}</span>
            <button
              type="button"
              class="hq-chip-rm"
              aria-label={`remove ${m}`}
              onclick={() => removeMetric(i)}
            >×</button>
          </span>
        {/each}
        <input
          type="text"
          class="hq-chip-draft"
          spellcheck="false"
          placeholder={metrics.length === 0 ? 'e.g. heart_rate, steps, hrv' : 'add another…'}
          value={metricDraft}
          oninput={(e) => (metricDraft = (e.currentTarget as HTMLInputElement).value)}
          onkeydown={onMetricKeydown}
          onblur={() => {
            if (metricDraft.trim()) addMetric(metricDraft);
          }}
        />
      </div>
      <div class="hq-suggest">
        <span class="hq-hint">Suggestions:</span>
        {#each METRIC_SUGGESTIONS as s (s)}
          {#if !metrics.some((m) => m.toLowerCase() === s.toLowerCase())}
            <button type="button" class="hq-suggest-chip" onclick={() => addMetric(s)}>
              + {s}
            </button>
          {/if}
        {/each}
      </div>
      <span class="hq-hint">
        Empty list means "all metrics". Press <kbd>Enter</kbd> or <kbd>,</kbd> to commit a chip.
      </span>
    </section>
  {:else}
    <section class="hq-sec hq-sec-disabled">
      <header class="hq-sec-hdr"><span class="sr-label-tight">Metrics filter</span></header>
      <p class="hq-empty">Not applicable for <strong>Activity Timeline</strong>.</p>
    </section>
  {/if}

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="hq-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="hq-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') {
            // Spread preserves any unknown keys callers may have added.
            setMany(next as Record<string, unknown>);
          }
        } catch { /* invalid — keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .hq { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .hq-sec { display: flex; flex-direction: column; gap: 8px; }
  .hq-sec-disabled { opacity: 0.55; }
  .hq-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .hq-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .hq-row { display: flex; gap: 10px; }
  .hq-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .hq-field-half { flex: 1; }
  .hq-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .hq-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .hq-hint code { font-size: var(--fs-label); color: var(--text-muted); }
  .hq-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }

  .hq-chip-input {
    display: flex; flex-wrap: wrap; gap: 4px;
    padding: 5px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    box-sizing: border-box;
    min-height: 32px;
  }
  .hq-chip-input:focus-within { border-color: var(--text-muted); }
  .hq-chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 4px 2px 8px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--card-border));
    font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary);
  }
  .hq-chip-text { white-space: nowrap; }
  .hq-chip-rm {
    background: transparent; border: none; color: var(--text-muted);
    font-size: var(--fs-body-sm); line-height: 1; padding: 0 2px;
    cursor: pointer;
  }
  .hq-chip-rm:hover { color: var(--status-error, #c0392b); }
  .hq-chip-draft {
    flex: 1; min-width: 120px;
    padding: 3px 4px;
    background: transparent; color: var(--text-primary);
    border: none; outline: none;
    font-family: var(--font-mono); font-size: var(--fs-label);
  }

  .hq-suggest { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .hq-suggest-chip {
    padding: 2px 8px;
    background: var(--bg); color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    cursor: pointer;
  }
  .hq-suggest-chip:hover { color: var(--text-primary); border-style: solid; }

  .hq-code {
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
  .hq-code:focus { border-color: var(--text-muted); }

  input[type='text'], input[type='date'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, input[type='date']:focus, select:focus, textarea:focus {
    border-color: var(--text-muted);
  }

  .hq-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .hq-raw summary { cursor: pointer; }

  kbd {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    padding: 1px 4px;
    background: var(--bg);
    border: 1px solid var(--card-border);
  }
</style>
