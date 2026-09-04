<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import HAEntityTree from './widgets/HAEntityTree.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // ---------- Operation enum ---------------------------------------------
  // Mirrors HAOperation in $lib/workflows/homeassistant/types and the switch
  // in home-assistant.ts. Each operation reveals only the fields the
  // executor reads for that branch — unknown keys are preserved verbatim by
  // spreading `config` in `set()`.

  type HAOp = 'query_state' | 'call_service' | 'fire_event' | 'get_history' | 'render_template';

  const OPERATIONS: Array<{ value: HAOp; label: string; blurb: string }> = [
    { value: 'query_state',     label: 'Query State',     blurb: 'Read current state + attributes of an entity.' },
    { value: 'call_service',    label: 'Call Service',    blurb: 'Invoke a HA service (turn_on, set_temperature, ...).' },
    { value: 'fire_event',      label: 'Fire Event',      blurb: 'Emit a HA event to trigger automations.' },
    { value: 'get_history',     label: 'Get History',     blurb: 'Fetch historical states for an entity over a window.' },
    { value: 'render_template', label: 'Render Template', blurb: 'Evaluate a Jinja2 template server-side.' },
  ];

  const operation = $derived<HAOp>(
    (OPERATIONS.find((o) => o.value === config.operation)?.value) ?? 'query_state',
  );
  const opMeta = $derived(OPERATIONS.find((o) => o.value === operation) ?? OPERATIONS[0]);

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }
  function setOperation(next: HAOp) {
    onChange({ ...config, operation: next });
  }

  // ---------- Validity hints ---------------------------------------------

  function isJsonString(raw: unknown): boolean | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    try { JSON.parse(s); return true; } catch { return false; }
  }
  const serviceDataValid = $derived(isJsonString(config.serviceData));
  const eventDataValid = $derived(isJsonString(config.eventData));

  const entityId = $derived(String(config.entityId ?? ''));
  const entityIds = $derived(Array.isArray(config.entityIds) ? (config.entityIds as string[]) : []);
  // query_state/get_history read MANY entities (entityIds[]); call_service
  // targets a single one (scalar entityId).
  const isMulti = $derived(operation === 'query_state' || operation === 'get_history');
  const derivedDomain = $derived(entityId.includes('.') ? entityId.split('.')[0] : '');

  // ---------- Raw JSON ---------------------------------------------------
  // `definition` is only used for typing — the canvas-level preview header
  // handles the "what this does" line.
  void definition;
</script>

<div class="ha">
  <!-- Operation pill toggle -->
  <section class="ha-sec">
    <header class="ha-sec-hdr">
      <span class="sr-label-tight">Operation</span>
      <span class="ha-sec-meta">{opMeta.blurb}</span>
    </header>
    <div class="ha-pills" role="radiogroup" aria-label="Operation">
      {#each OPERATIONS as op (op.value)}
        <button
          type="button"
          role="radio"
          aria-checked={operation === op.value}
          class="ha-pill"
          class:ha-pill-active={operation === op.value}
          onclick={() => setOperation(op.value)}
        >
          {op.label}
        </button>
      {/each}
    </div>
  </section>

  <!-- Entity ID — used by query_state, call_service (optional), get_history -->
  {#if operation === 'query_state' || operation === 'call_service' || operation === 'get_history'}
    <section class="ha-sec">
      <header class="ha-sec-hdr">
        <span class="sr-label-tight">Entity</span>
        {#if operation === 'call_service'}
          <span class="ha-sec-meta">optional — omit for service calls without a target</span>
        {/if}
      </header>
      <div class="ha-field">
        <HAEntityTree
          multiple={isMulti}
          selected={isMulti ? entityIds : (entityId ? [entityId] : [])}
          onChange={(ids) => (isMulti ? set('entityIds', ids) : set('entityId', ids[0] ?? ''))}
          manualValue={entityId}
          onManualChange={(v) => set('entityId', v)}
        />
      </div>
    </section>
  {/if}

  <!-- Call Service: domain + service + JSON data -->
  {#if operation === 'call_service'}
    <section class="ha-sec">
      <header class="ha-sec-hdr"><span class="sr-label-tight">Service call</span></header>
      <div class="ha-row">
        <label class="ha-field">
          <span class="ha-label">Domain</span>
          <input
            type="text"
            spellcheck="false"
            placeholder={derivedDomain || 'light'}
            value={String(config.domain ?? '')}
            oninput={(e) => set('domain', (e.currentTarget as HTMLInputElement).value)}
          />
          <span class="ha-hint">
            {#if !config.domain && derivedDomain}
              Auto-derived from entity: <code>{derivedDomain}</code>
            {:else}
              Templates supported.
            {/if}
          </span>
        </label>
        <label class="ha-field">
          <span class="ha-label">Service</span>
          <input
            type="text"
            spellcheck="false"
            placeholder="turn_on"
            value={String(config.service ?? '')}
            oninput={(e) => set('service', (e.currentTarget as HTMLInputElement).value)}
          />
          <span class="ha-hint">e.g. <code>turn_on</code>, <code>turn_off</code>, <code>set_temperature</code></span>
        </label>
      </div>
      <label class="ha-field">
        <span class="ha-label">
          Service Data (JSON)
          {#if serviceDataValid === true}<span class="ha-ok">JSON ✓</span>{/if}
          {#if serviceDataValid === false}<span class="ha-warn">invalid JSON — will be ignored</span>{/if}
        </span>
        <textarea
          class="ha-code"
          rows="4"
          spellcheck="false"
          placeholder={`{ "brightness": 128, "color_name": "warm_white" }`}
          value={String(config.serviceData ?? '')}
          oninput={(e) => set('serviceData', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="ha-hint">Templates supported. Must be valid JSON when interpolated.</span>
      </label>
    </section>
  {/if}

  <!-- Fire Event: type + data -->
  {#if operation === 'fire_event'}
    <section class="ha-sec">
      <header class="ha-sec-hdr"><span class="sr-label-tight">Event</span></header>
      <label class="ha-field">
        <span class="ha-label">Event type</span>
        <input
          type="text"
          spellcheck="false"
          placeholder="custom_event"
          value={String(config.eventType ?? '')}
          oninput={(e) => set('eventType', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="ha-hint">Templates supported.</span>
      </label>
      <label class="ha-field">
        <span class="ha-label">
          Event data (JSON)
          {#if eventDataValid === true}<span class="ha-ok">JSON ✓</span>{/if}
          {#if eventDataValid === false}<span class="ha-warn">invalid JSON — will be ignored</span>{/if}
        </span>
        <textarea
          class="ha-code"
          rows="4"
          spellcheck="false"
          placeholder={`{ "source": {{input.source}} }`}
          value={String(config.eventData ?? '')}
          oninput={(e) => set('eventData', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="ha-hint">Templates supported. Must be valid JSON when interpolated.</span>
      </label>
    </section>
  {/if}

  <!-- Get History: start + end -->
  {#if operation === 'get_history'}
    <section class="ha-sec">
      <header class="ha-sec-hdr">
        <span class="sr-label-tight">Time window</span>
        <span class="ha-sec-meta">leave blank for HA defaults (last day)</span>
      </header>
      <div class="ha-row">
        <label class="ha-field">
          <span class="ha-label">Start (ISO 8601)</span>
          <input
            type="text"
            spellcheck="false"
            placeholder="2026-04-14T00:00:00Z"
            value={String(config.historyStart ?? '')}
            oninput={(e) => set('historyStart', (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="ha-field">
          <span class="ha-label">End (ISO 8601)</span>
          <input
            type="text"
            spellcheck="false"
            placeholder="2026-04-15T00:00:00Z"
            value={String(config.historyEnd ?? '')}
            oninput={(e) => set('historyEnd', (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>
      <span class="ha-hint">Templates supported: <code>{`{{input.start_time}}`}</code></span>
    </section>
  {/if}

  <!-- Render Template -->
  {#if operation === 'render_template'}
    <section class="ha-sec">
      <header class="ha-sec-hdr"><span class="sr-label-tight">Jinja2 template</span></header>
      <textarea
        class="ha-code"
        rows="6"
        spellcheck="false"
        placeholder={`{{ states("light.living_room") }}`}
        value={String(config.template ?? '')}
        oninput={(e) => set('template', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="ha-hint">Rendered server-side by Home Assistant. <code>{`{{input.field}}`}</code> is interpolated <em>before</em> sending.</span>
    </section>
  {/if}

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <RawConfigEditor {config} {onChange} />
</div>

<style>
  .ha { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .ha-sec { display: flex; flex-direction: column; gap: 8px; }
  .ha-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .ha-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .ha-pills {
    display: flex; flex-wrap: wrap; gap: 4px;
  }
  .ha-pill {
    flex: 1 1 auto;
    min-width: 0;
    padding: 8px 10px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .ha-pill:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .ha-pill-active {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .ha-row { display: flex; gap: 10px; }
  .ha-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .ha-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    display: inline-flex; gap: 6px; align-items: baseline;
  }
  .ha-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .ha-hint code, .ha-label code { font-size: var(--fs-label); color: var(--text-muted); }

  .ha-code {
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
  .ha-code:focus { border-color: var(--text-muted); }

  .ha-warn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-error, #c0392b); }
  .ha-ok   { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-success, #2a9d4a); }

  input[type='text'], textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }
</style>
