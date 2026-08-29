<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import TemplatedTextarea from './shared/TemplatedTextarea.svelte';
  import ModelSelect from './widgets/ModelSelect.svelte';
  import TemperatureField from './widgets/TemperatureField.svelte';
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

  // Canvas-level page renders the "What this does" preview; we don't repeat it.
  void definition;

  // ---------- Routes (stored as a JSON string in config.routes) -------------
  // Executor parses `config.routes` as JSON: Array<{ handle, description }>.
  // We expose a structured table editor and round-trip the JSON string so
  // unrelated tooling that reads the raw config keeps working.

  type Route = { handle: string; description: string };

  function parseRoutes(raw: unknown): Route[] {
    // Accept either a stringified JSON array (canonical) or an inline array
    // (some callers/orchestrators write the unstringified form).
    let value: unknown = raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return [];
      try { value = JSON.parse(trimmed); } catch { return []; }
    }
    if (!Array.isArray(value)) return [];
    return value
      .filter((r) => r && typeof r === 'object')
      .map((r) => {
        const obj = r as Record<string, unknown>;
        return {
          handle: String(obj.handle ?? obj.name ?? ''),
          description: String(obj.description ?? ''),
        };
      });
  }

  function stringifyRoutes(rows: Route[]): string {
    // Match the default-config shape (pretty-printed two-space indent).
    return JSON.stringify(
      rows.map((r) => ({ handle: r.handle, description: r.description })),
      null,
      2,
    );
  }

  const routes = $derived(parseRoutes(config.routes));
  const routesAreValid = $derived.by(() => {
    const raw = config.routes;
    if (raw == null) return true;
    if (Array.isArray(raw)) return true;
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (!t) return true;
      try {
        const v = JSON.parse(t);
        return Array.isArray(v);
      } catch { return false; }
    }
    return false;
  });

  function setRoutes(rows: Route[]) {
    onChange({ ...config, routes: stringifyRoutes(rows) });
  }
  function addRoute() {
    setRoutes([...routes, { handle: '', description: '' }]);
  }
  function updateRoute(i: number, patch: Partial<Route>) {
    const next = routes.slice();
    next[i] = { ...next[i], ...patch };
    setRoutes(next);
  }
  function removeRoute(i: number) {
    const next = routes.slice();
    next.splice(i, 1);
    setRoutes(next);
  }

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  const model = $derived(String(config.model ?? ''));
  const systemPrompt = $derived(String(config.systemPrompt ?? ''));
  const userPrompt = $derived(String(config.userPrompt ?? ''));
  const temperature = $derived.by(() => {
    const raw = config.temperature;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(2, n));
    // Executor's intrinsic default is 0.1 (deterministic routing). Surface
    // that as the slider's start position so users see what's actually used.
    return 0.1;
  });

  // ---------- Compiled router prompt preview --------------------------------
  // The executor builds a system prompt from the routes; we replicate that
  // here so users can see what the model will actually receive. Stays in
  // sync with llm-router.ts.

  const compiledSystemPrompt = $derived.by(() => {
    const list = routes
      .map((r, i) => `${i + 1}. "${r.handle}" — ${r.description}`)
      .join('\n');
    const base = systemPrompt.trim()
      ? `${systemPrompt.trim()}\n\n`
      : '';
    return `${base}You are a routing engine. Given input data and routes, respond with ONLY the handle name of the best matching route. No explanation, no quotes.\n\nAvailable routes:\n${list || '(no routes defined)'}`;
  });

  // ---------- Validation helpers --------------------------------------------

  const duplicateHandles = $derived.by(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const r of routes) {
      const h = r.handle.trim();
      if (!h) continue;
      if (seen.has(h)) dupes.add(h);
      seen.add(h);
    }
    return dupes;
  });

  // ---------- Raw JSON ------------------------------------------------------

  let showRawJson = $state(false);
  let showCompiled = $state(false);
</script>

<div class="lr">
  <!-- Routes — the unique selling point: prominent, top of panel. -->
  <section class="lr-sec lr-routes">
    <header class="lr-sec-hdr">
      <span class="sr-label-tight">Routes</span>
      <span class="lr-sec-meta">
        {routes.length} {routes.length === 1 ? 'route' : 'routes'}
        {#if !routesAreValid}<span class="lr-warn"> · stored JSON invalid</span>{/if}
      </span>
    </header>
    <p class="lr-blurb">
      The LLM picks one of these handles based on the input. Each handle becomes
      a source edge on this node — connect downstream nodes to the matching
      output to follow that path.
    </p>
    {#if routes.length === 0}
      <p class="lr-empty">No routes defined yet. Add at least two so the model has a choice.</p>
    {:else}
      <div class="lr-route-grid">
        <div class="lr-route-head">Handle</div>
        <div class="lr-route-head">When to pick this route</div>
        <div></div>
        {#each routes as r, i (i)}
          {@const dupe = r.handle.trim() && duplicateHandles.has(r.handle.trim())}
          <input
            type="text"
            class="lr-route-input lr-route-handle"
            class:lr-input-bad={dupe || !r.handle.trim()}
            spellcheck="false"
            placeholder="e.g. positive"
            value={r.handle}
            oninput={(e) => updateRoute(i, { handle: (e.currentTarget as HTMLInputElement).value })}
          />
          <input
            type="text"
            class="lr-route-input"
            placeholder="When the model should pick this route"
            value={r.description}
            oninput={(e) => updateRoute(i, { description: (e.currentTarget as HTMLInputElement).value })}
          />
          <button type="button" class="lr-route-rm" onclick={() => removeRoute(i)} aria-label="remove route">×</button>
        {/each}
      </div>
      {#if duplicateHandles.size > 0}
        <p class="lr-warn-line">Duplicate handle{duplicateHandles.size === 1 ? '' : 's'}: {[...duplicateHandles].join(', ')}. Each handle must be unique.</p>
      {/if}
    {/if}
    <button type="button" class="lr-add" onclick={addRoute}>+ Add route</button>
    <p class="lr-hint">
      The handle is the technical name (output edge). The description is what
      the LLM reads when deciding — write it as a discriminating sentence.
    </p>
  </section>

  <!-- System prompt (optional pre-amble; executor still injects routing instructions) -->
  <section class="lr-sec">
    <label class="lr-field">
      <span class="lr-label">System Prompt — extra context for the router (optional)</span>
      <TemplatedTextarea
        class="lr-code"
        rows={3}
        spellcheck={false}
        placeholder="You are routing customer support tickets by topic."
        value={systemPrompt}
        upstreamFields={upstreamFields}
        onChange={(v) => set('systemPrompt', v)}
      />
      <span class="lr-hint">Prepended to the routing instructions. Leave blank to use only the auto-generated routing prompt.</span>
    </label>
  </section>

  <!-- User prompt (optional; executor stringifies input by default) -->
  <section class="lr-sec">
    <label class="lr-field">
      <span class="lr-label">User Prompt — what the model classifies (optional)</span>
      <TemplatedTextarea
        class="lr-code"
        rows={3}
        spellcheck={false}
        placeholder={'Classify this message: {{input.text}}'}
        value={userPrompt}
        upstreamFields={upstreamFields}
        onChange={(v) => set('userPrompt', v)}
      />
      <span class="lr-hint">If blank, the full input object is sent as JSON. Templates: <code>{`{{input.field}}`}</code>.</span>
    </label>
  </section>

  <ModelSelect
    value={model}
    onChange={(v) => set('model', v)}
    fetcher={fetchAllChatModels}
    hint="Leave on Default to use the admin-configured site default. Routing benefits from a small fast model — full live OpenRouter catalogue available in the picker."
  />

  <TemperatureField
    value={temperature}
    onChange={(v) => set('temperature', v)}
    hint="Routing usually wants <strong>0.0 – 0.2</strong> for consistent, deterministic picks."
  />

  <!-- Compiled router prompt — what the LLM actually sees -->
  <details class="lr-compiled" bind:open={showCompiled}>
    <summary><span class="sr-label-tight">Compiled router prompt — what the LLM sees</span></summary>
    <pre class="lr-compiled-body">{compiledSystemPrompt}</pre>
  </details>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="lr-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="lr-code"
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
  .lr { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .lr-sec { display: flex; flex-direction: column; gap: 8px; }
  .lr-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .lr-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  /* Routes section is the marquee feature — give it slightly more presence. */
  .lr-routes {
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    padding: 10px 12px;
  }
  .lr-blurb {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-muted);
    line-height: 1.45;
  }

  .lr-route-grid {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(0, 2fr) 24px;
    gap: 4px;
  }
  .lr-route-head {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  .lr-route-input {
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
  }
  .lr-route-input:focus { border-color: var(--text-muted); }
  .lr-route-handle { font-weight: 600; }
  .lr-input-bad { border-color: var(--status-error, #c0392b); }
  .lr-route-rm {
    background: transparent; color: var(--text-muted);
    border: 1px solid var(--card-border); cursor: pointer;
  }
  .lr-route-rm:hover { color: var(--status-error, #c0392b); }

  .lr-add {
    align-self: flex-start;
    padding: 4px 10px;
    background: var(--bg); color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .lr-add:hover { color: var(--text-primary); }

  .lr-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }

  .lr-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .lr-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .lr-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .lr-hint code, .lr-label code { font-size: var(--fs-label); color: var(--text-muted); }

  .lr-warn { color: var(--status-error, #c0392b); }
  .lr-warn-line {
    margin: 0;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
  }

  .lr-temp-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  }
  .lr-temp-readout {
    display: inline-flex; gap: 8px; align-items: baseline;
    font-family: var(--font-mono); font-size: var(--fs-label);
  }
  .lr-temp-value { color: var(--text-primary); }
  .lr-temp-word {
    color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.06em; font-size: var(--fs-label-xs);
  }
  .lr-range {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .lr-code {
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
  .lr-code:focus { border-color: var(--text-muted); }

  .lr-compiled {
    border: 1px dashed var(--card-border);
    padding: 6px 10px;
    background: color-mix(in srgb, var(--bg) 90%, transparent);
  }
  .lr-compiled summary { cursor: pointer; }
  .lr-compiled-body {
    margin: 8px 0 0;
    padding: 8px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    font-family: var(--font-code); font-size: var(--fs-label);
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow: auto;
  }

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

  .lr-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .lr-raw summary { cursor: pointer; }
</style>
