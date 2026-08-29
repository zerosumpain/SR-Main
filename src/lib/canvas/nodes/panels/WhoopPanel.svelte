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

  // The Whoop executor reads:
  //   operation: 'get_summary' | 'get_recent' | 'query_recovery'
  //              | 'get_cycles' | 'get_recovery' | 'get_sleep' | 'get_workouts'
  //   days     : trailing window for DB-backed summary / recent
  //   metric   : for query_recovery
  //   limit    : max records (API-backed ops)
  //   start    : ISO start date (optional)
  //   end      : ISO end date (optional)
  //
  // We expose all these via a structured editor while preserving any other
  // keys via spread, and mount the OnErrorBlock + raw-JSON disclosure.

  type Op =
    | 'get_summary'
    | 'get_recent'
    | 'query_recovery'
    | 'get_cycles'
    | 'get_recovery'
    | 'get_sleep'
    | 'get_workouts';

  const OPERATIONS: Array<{ value: Op; label: string; group: 'db' | 'api' }> = [
    { value: 'get_summary', label: 'Summary', group: 'db' },
    { value: 'get_recent', label: 'Recent days', group: 'db' },
    { value: 'query_recovery', label: 'Query metric series', group: 'db' },
    { value: 'get_recovery', label: 'Recoveries', group: 'api' },
    { value: 'get_sleep', label: 'Sleep', group: 'api' },
    { value: 'get_cycles', label: 'Cycles', group: 'api' },
    { value: 'get_workouts', label: 'Workouts', group: 'api' },
  ];

  const operation = $derived<Op>((config.operation as Op) || 'get_summary');
  const opMeta = $derived(OPERATIONS.find((o) => o.value === operation));
  const isApi = $derived(opMeta?.group === 'api');
  const isDb = $derived(opMeta?.group === 'db');

  // ---- Date-range preset --------------------------------------------------
  // We don't persist the preset itself — it derives from days / start / end.
  // Selecting a non-custom preset clears `start` and `end` and sets `days`.
  // Selecting "custom" reveals two date inputs and clears `days`.

  type Preset = 'today' | 'last7' | 'last30' | 'last90' | 'custom';

  const start = $derived(String(config.start ?? ''));
  const end = $derived(String(config.end ?? ''));
  const days = $derived(
    config.days != null && Number.isFinite(Number(config.days)) ? Number(config.days) : null,
  );

  const preset = $derived<Preset>(
    start || end
      ? 'custom'
      : days === 1
        ? 'today'
        : days === 7
          ? 'last7'
          : days === 30
            ? 'last30'
            : days === 90
              ? 'last90'
              : 'custom',
  );

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function unset(...keys: string[]) {
    const next = { ...config };
    for (const k of keys) delete next[k];
    onChange(next);
  }

  function applyPreset(p: Preset) {
    if (p === 'custom') {
      // Keep whatever start/end exist; just clear days so they take effect.
      const next = { ...config };
      delete next.days;
      onChange(next);
      return;
    }
    const map: Record<Exclude<Preset, 'custom'>, number> = {
      today: 1,
      last7: 7,
      last30: 30,
      last90: 90,
    };
    const next: Record<string, unknown> = { ...config, days: map[p] };
    delete next.start;
    delete next.end;
    onChange(next);
  }

  function setLimit(raw: string) {
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n)) {
      unset('limit');
      return;
    }
    set('limit', Math.max(1, Math.floor(n)));
  }

  function setDays(raw: string) {
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n)) {
      unset('days');
      return;
    }
    set('days', Math.max(1, Math.floor(n)));
  }

  function setOperation(next: Op) {
    // Don't strip metric/days/limit on op change — they're shared and the
    // executor ignores keys that don't apply. Just update operation.
    set('operation', next);
  }

  // ---- Raw JSON ------------------------------------------------------------

  let showRawJson = $state(false);
  void definition;
</script>

<div class="wh">
  <!-- Operation -->
  <section class="wh-sec">
    <header class="wh-sec-hdr">
      <span class="sr-label-tight">Endpoint</span>
      <span class="wh-sec-meta">{isApi ? 'live API · costs a Whoop API hit' : 'DB-backed · fast & free'}</span>
    </header>
    <div class="wh-pills">
      {#each OPERATIONS as op (op.value)}
        <button
          type="button"
          class="wh-pill"
          class:wh-pill-active={operation === op.value}
          class:wh-pill-api={op.group === 'api'}
          onclick={() => setOperation(op.value)}
        >
          <span class="wh-pill-label">{op.label}</span>
          <span class="wh-pill-tag">{op.group === 'api' ? 'API' : 'DB'}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Metric (only for query_recovery) -->
  {#if operation === 'query_recovery'}
    <section class="wh-sec">
      <header class="wh-sec-hdr"><span class="sr-label-tight">Metric</span></header>
      <label class="wh-field">
        <span class="wh-label">Series</span>
        <select
          value={String(config.metric ?? 'recovery')}
          onchange={(e) => set('metric', (e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="recovery">Recovery score (%)</option>
          <option value="hrv">HRV (ms)</option>
          <option value="rhr">Resting heart rate (bpm)</option>
          <option value="sleep_performance">Sleep performance (%)</option>
          <option value="strain">Strain (cycle)</option>
        </select>
      </label>
    </section>
  {/if}

  <!-- Date range -->
  <section class="wh-sec">
    <header class="wh-sec-hdr">
      <span class="sr-label-tight">Date range</span>
      <span class="wh-sec-meta">
        {preset === 'custom'
          ? 'custom range'
          : preset === 'today'
            ? 'today'
            : preset === 'last7'
              ? 'last 7 days'
              : preset === 'last30'
                ? 'last 30 days'
                : 'last 90 days'}
      </span>
    </header>
    <label class="wh-field">
      <span class="wh-label">Preset</span>
      <select
        value={preset}
        onchange={(e) => applyPreset((e.currentTarget as HTMLSelectElement).value as Preset)}
      >
        <option value="today">Today</option>
        <option value="last7">Last 7 days</option>
        <option value="last30">Last 30 days</option>
        <option value="last90">Last 90 days</option>
        <option value="custom">Custom range…</option>
      </select>
    </label>

    {#if preset === 'custom'}
      <div class="wh-row">
        <label class="wh-field wh-field-half">
          <span class="wh-label">From (ISO date)</span>
          <input
            type="text"
            spellcheck="false"
            placeholder={'2026-01-01T00:00:00Z or {{input.from}}'}
            value={start}
            oninput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              if (v.trim()) set('start', v);
              else unset('start');
            }}
          />
        </label>
        <label class="wh-field wh-field-half">
          <span class="wh-label">To (ISO date)</span>
          <input
            type="text"
            spellcheck="false"
            placeholder={'2026-04-18T00:00:00Z or {{input.to}}'}
            value={end}
            oninput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              if (v.trim()) set('end', v);
              else unset('end');
            }}
          />
        </label>
      </div>
      <p class="wh-hint">
        Templates supported: <code>{`{{input.field}}`}</code>. Leave either side blank to default
        to a {days ?? 30}-day window ending now.
      </p>
    {:else}
      <label class="wh-field">
        <span class="wh-label">Trailing days</span>
        <input
          type="number"
          min="1"
          step="1"
          value={days ?? ''}
          oninput={(e) => setDays((e.currentTarget as HTMLInputElement).value)}
        />
        <span class="wh-hint">Used by DB-backed ops (Summary / Recent / Query metric).</span>
      </label>
    {/if}
  </section>

  <!-- Limit (API ops + recent) -->
  {#if isApi || operation === 'get_recent'}
    <section class="wh-sec">
      <header class="wh-sec-hdr">
        <span class="sr-label-tight">Limit</span>
        <span class="wh-sec-meta">{isApi ? 'API max records' : 'caps recent rows'}</span>
      </header>
      <label class="wh-field">
        <span class="wh-label">Max records</span>
        <input
          type="number"
          min="1"
          step="1"
          placeholder="10"
          value={config.limit != null && Number.isFinite(Number(config.limit)) ? Number(config.limit) : ''}
          oninput={(e) => setLimit((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </section>
  {/if}

  {#if isDb}
    <p class="wh-note">
      DB-backed operations read from the local Whoop tables synced by the health pipeline — no
      Whoop API call. Switch to an <strong>API</strong> endpoint to fetch live records.
    </p>
  {/if}

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="wh-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="wh-code"
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
  .wh { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .wh-sec { display: flex; flex-direction: column; gap: 8px; }
  .wh-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .wh-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .wh-row { display: flex; gap: 10px; }
  .wh-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .wh-field-half { flex: 1; }
  .wh-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  .wh-hint { font-size: var(--fs-label); color: var(--text-ghost); margin: 0; }
  .wh-hint code { font-size: var(--fs-label); color: var(--text-muted); }

  .wh-pills {
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .wh-pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 10px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    font: inherit;
    font-size: var(--fs-label);
    cursor: pointer;
    outline: none;
  }
  .wh-pill:hover { color: var(--text-primary); }
  .wh-pill-active {
    color: var(--text-primary);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .wh-pill-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .wh-pill-api .wh-pill-tag {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--card-border));
  }

  .wh-note {
    margin: 0;
    padding: 8px 10px;
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    border: 1px solid var(--card-border);
    font-size: var(--fs-label);
    color: var(--text-muted);
  }

  .wh-code {
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
  .wh-code:focus { border-color: var(--text-muted); }

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

  .wh-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .wh-raw summary { cursor: pointer; }
</style>

