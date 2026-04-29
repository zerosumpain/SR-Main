<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ChipInputField from './widgets/ChipInputField.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // ---------- Endpoint (executor's `operation` key) ----------------------
  // The strava executor dispatches on `config.operation`. We surface it as a
  // friendly "Endpoint" dropdown so the panel reads as data-shape, not RPC.

  const ENDPOINTS: Array<{ value: string; label: string; group: 'db' | 'api' }> = [
    { value: 'get_summary',       label: 'Activities — Summary (DB · totals over range)', group: 'db' },
    { value: 'query_activities',  label: 'Activities — Query (DB · filtered list)',       group: 'db' },
    { value: 'list_activities',   label: 'Activities — List (Strava API)',                 group: 'api' },
    { value: 'get_activity',      label: 'Activity — Get one (Strava API)',                group: 'api' },
    { value: 'get_athlete_stats', label: 'Athlete — Stats (Strava API)',                   group: 'api' },
  ];

  const endpoint = $derived(String(config.operation ?? 'get_summary'));
  const endpointGroup = $derived(
    ENDPOINTS.find((e) => e.value === endpoint)?.group ?? 'db',
  );
  const supportsRange = $derived(
    endpoint === 'get_summary' ||
      endpoint === 'query_activities' ||
      endpoint === 'list_activities',
  );
  const supportsSportFilter = $derived(
    endpoint === 'get_summary' || endpoint === 'query_activities',
  );
  const supportsMinDistance = $derived(endpoint === 'query_activities');
  const supportsActivityId = $derived(endpoint === 'get_activity');
  const supportsPagination = $derived(endpoint === 'list_activities');

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Date range with preset --------------------------------------
  // For DB endpoints (get_summary / query_activities), `days` is the trailing
  // window. For list_activities (API), the executor honours `start`/`end` ISO
  // dates as Unix bounds. We expose a preset dropdown that drives whichever
  // shape the current endpoint understands.

  type RangeMode = 'last7' | 'last30' | 'last90' | 'custom';

  function inferRangeMode(): RangeMode {
    const start = String(config.start ?? '').trim();
    const end = String(config.end ?? '').trim();
    if (start || end) return 'custom';
    const d = Number(config.days ?? 30);
    if (d === 7) return 'last7';
    if (d === 30) return 'last30';
    if (d === 90) return 'last90';
    return 'custom';
  }

  const rangeMode = $derived<RangeMode>(inferRangeMode());

  function setRangeMode(mode: RangeMode) {
    if (mode === 'custom') {
      // Leave start/end alone — user will edit them.
      onChange({ ...config, _rangeMode: 'custom' });
      return;
    }
    const days = mode === 'last7' ? 7 : mode === 'last30' ? 30 : 90;
    // Clearing start/end so DB resolveRange falls back to `days`. For API
    // list_activities, we synthesise start/end from the chosen window.
    if (endpointGroup === 'api') {
      const now = Date.now();
      const startIso = new Date(now - days * 86_400_000).toISOString();
      const endIso = new Date(now).toISOString();
      onChange({ ...config, days, start: startIso, end: endIso, _rangeMode: mode });
    } else {
      const next = { ...config, days, _rangeMode: mode } as Record<string, unknown>;
      delete next.start;
      delete next.end;
      onChange(next);
    }
  }

  // ---------- Activity-type filter (chip-input) ---------------------------
  // The executor reads a single `sportType` string. We accept a multi-chip
  // UX and mirror the first chip into `sportType` so existing logic still
  // matches. The full chip array is preserved under `sportTypes` for future
  // multi-value support and round-trips through the raw-JSON editor.

  function readSportTypes(): string[] {
    const arr = config.sportTypes;
    if (Array.isArray(arr)) return arr.map((x) => String(x)).filter(Boolean);
    const single = String(config.sportType ?? '').trim();
    return single ? [single] : [];
  }

  const sportTypes = $derived(readSportTypes());

  function setSportTypes(next: string[]) {
    const cleaned = next.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      const out = { ...config } as Record<string, unknown>;
      delete out.sportType;
      delete out.sportTypes;
      onChange(out);
      return;
    }
    onChange({ ...config, sportType: cleaned[0], sportTypes: cleaned });
  }

  // ---------- Numeric helpers --------------------------------------------

  function parseIntOr(v: unknown, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  }

  // ---------- Raw JSON disclosure ----------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header handles any "what this does" line.
  void definition;
</script>

<div class="st-panel">
  <!-- Endpoint -->
  <section class="st-sec">
    <header class="st-sec-hdr">
      <span class="sr-label-tight">Endpoint</span>
      <span class="st-sec-meta">{endpointGroup === 'db' ? 'DB-backed · fast' : 'Strava API · live'}</span>
    </header>
    <label class="st-field">
      <span class="st-label">Action</span>
      <select
        value={endpoint}
        onchange={(e) => set('operation', (e.currentTarget as HTMLSelectElement).value)}
      >
        {#each ENDPOINTS as ep (ep.value)}
          <option value={ep.value}>{ep.label}</option>
        {/each}
      </select>
      <span class="st-hint">
        DB endpoints query the local <code>strava_activities</code> mirror. API endpoints
        require Strava connected in <code>/admin/health</code>.
      </span>
    </label>
  </section>

  <!-- Date range -->
  {#if supportsRange}
    <section class="st-sec">
      <header class="st-sec-hdr">
        <span class="sr-label-tight">Date range</span>
      </header>
      <label class="st-field">
        <span class="st-label">Preset</span>
        <select
          value={rangeMode}
          onchange={(e) => setRangeMode((e.currentTarget as HTMLSelectElement).value as RangeMode)}
        >
          <option value="last7">Last 7 days</option>
          <option value="last30">Last 30 days</option>
          <option value="last90">Last 90 days</option>
          <option value="custom">Custom range</option>
        </select>
      </label>
      {#if rangeMode === 'custom'}
        <div class="st-row">
          <label class="st-field st-field-half">
            <span class="st-label">Start (ISO)</span>
            <input
              type="text"
              spellcheck="false"
              placeholder={'2026-01-01T00:00:00Z or {{input.start}}'}
              value={String(config.start ?? '')}
              oninput={(e) => set('start', (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="st-field st-field-half">
            <span class="st-label">End (ISO)</span>
            <input
              type="text"
              spellcheck="false"
              placeholder={'2026-04-29T00:00:00Z or {{input.end}}'}
              value={String(config.end ?? '')}
              oninput={(e) => set('end', (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
        </div>
        <span class="st-hint">Leave blank to fall back to a trailing-days window.</span>
      {:else if endpointGroup === 'db'}
        <span class="st-hint">
          Trailing window of <code>{Number(config.days ?? 30)}</code> day(s). Templates
          like <code>{`{{input.days}}`}</code> are honoured by the executor.
        </span>
      {/if}
    </section>
  {/if}

  <!-- Activity-type filter -->
  {#if supportsSportFilter}
    <section class="st-sec">
      <header class="st-sec-hdr">
        <span class="sr-label-tight">Activity type</span>
        <span class="st-sec-meta">{sportTypes.length} {sportTypes.length === 1 ? 'type' : 'types'}</span>
      </header>
      <ChipInputField
        value={sportTypes}
        placeholder="Run, Ride, TrailRun, Swim — Enter to add"
        onChange={setSportTypes}
      />
      <span class="st-hint">
        Strava <code>sport_type</code> values (case-sensitive): <code>Run</code>, <code>Ride</code>,
        <code>TrailRun</code>, <code>Swim</code>, <code>Hike</code>, <code>Walk</code>,
        <code>VirtualRide</code>… Multi-select preserved; the DB filter matches the first chip today.
      </span>
    </section>
  {/if}

  <!-- Min distance (query_activities only) -->
  {#if supportsMinDistance}
    <section class="st-sec">
      <header class="st-sec-hdr">
        <span class="sr-label-tight">Distance filter</span>
      </header>
      <label class="st-field">
        <span class="st-label">Min distance (m)</span>
        <input
          type="number"
          min="0"
          step="100"
          value={Number(config.minDistanceMeters ?? 0)}
          oninput={(e) => set('minDistanceMeters', Math.max(0, parseIntOr((e.currentTarget as HTMLInputElement).value, 0)))}
        />
        <span class="st-hint">Skip activities shorter than this. <code>0</code> disables the filter.</span>
      </label>
    </section>
  {/if}

  <!-- Activity ID (get_activity only) -->
  {#if supportsActivityId}
    <section class="st-sec">
      <header class="st-sec-hdr">
        <span class="sr-label-tight">Activity</span>
      </header>
      <label class="st-field">
        <span class="st-label">Activity ID</span>
        <input
          type="text"
          spellcheck="false"
          placeholder={'1234567890 or {{input.activityId}}'}
          value={String(config.activityId ?? '')}
          oninput={(e) => set('activityId', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="st-hint">Numeric Strava activity ID. Templates supported.</span>
      </label>
    </section>
  {/if}

  <!-- Pagination + max results (list_activities only) -->
  {#if supportsPagination}
    <section class="st-sec">
      <header class="st-sec-hdr">
        <span class="sr-label-tight">Pagination</span>
      </header>
      <div class="st-row">
        <label class="st-field st-field-half">
          <span class="st-label">Page</span>
          <input
            type="number"
            min="1"
            step="1"
            value={Number(config.page ?? 1)}
            oninput={(e) => set('page', Math.max(1, parseIntOr((e.currentTarget as HTMLInputElement).value, 1)))}
          />
        </label>
        <label class="st-field st-field-half">
          <span class="st-label">Max results / page</span>
          <input
            type="number"
            min="1"
            max="200"
            step="1"
            value={Number(config.perPage ?? 30)}
            oninput={(e) => set('perPage', Math.max(1, Math.min(200, parseIntOr((e.currentTarget as HTMLInputElement).value, 30))))}
          />
        </label>
      </div>
      <span class="st-hint">Strava API caps <code>per_page</code> at 200.</span>
    </section>
  {/if}

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="st-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="st-code"
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
  .st-panel { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .st-sec { display: flex; flex-direction: column; gap: 8px; }
  .st-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .st-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .st-row { display: flex; gap: 10px; }
  .st-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .st-field-half { flex: 1; }
  .st-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .st-hint { font-size: 11px; color: var(--text-ghost); }
  .st-hint code, .st-label code { font-size: 11px; color: var(--text-muted); }

  .st-code {
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
  .st-code:focus { border-color: var(--text-muted); }

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

  .st-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .st-raw summary { cursor: pointer; }
</style>
