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

  // ---------- URL splitting / rebuilding ----------------------------------
  // We keep `config.url` as a single string (the executor reads it verbatim
  // and runs template interpolation), but expose a structured editor: a base
  // path, plus a key-value table of query parameters. Splitting and rebuild
  // happens at edit time.

  function splitUrl(raw: string): { base: string; params: Array<{ k: string; v: string }> } {
    if (!raw) return { base: '', params: [] };
    const qIdx = raw.indexOf('?');
    if (qIdx < 0) return { base: raw, params: [] };
    const base = raw.slice(0, qIdx);
    const query = raw.slice(qIdx + 1);
    const params: Array<{ k: string; v: string }> = [];
    for (const segment of query.split('&')) {
      if (!segment) continue;
      const eq = segment.indexOf('=');
      if (eq < 0) {
        params.push({ k: decodeMaybe(segment), v: '' });
      } else {
        params.push({ k: decodeMaybe(segment.slice(0, eq)), v: decodeMaybe(segment.slice(eq + 1)) });
      }
    }
    return { base, params };
  }

  function decodeMaybe(s: string): string {
    // Don't double-encode templates like {{input.foo}}
    if (s.includes('{{') || s.includes('}}')) return s;
    try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
  }
  function encodeMaybe(s: string): string {
    if (s.includes('{{') || s.includes('}}')) return s;
    return encodeURIComponent(s);
  }

  function joinUrl(base: string, params: Array<{ k: string; v: string }>): string {
    const live = params.filter((p) => p.k.trim());
    if (live.length === 0) return base;
    const qs = live.map((p) => `${encodeMaybe(p.k)}=${encodeMaybe(p.v)}`).join('&');
    return `${base}?${qs}`;
  }

  const split = $derived(splitUrl(String(config.url ?? '')));

  function setUrlBase(base: string) {
    onChange({ ...config, url: joinUrl(base, split.params) });
  }
  function setQueryParams(params: Array<{ k: string; v: string }>) {
    onChange({ ...config, url: joinUrl(split.base, params) });
  }
  function addParam() {
    setQueryParams([...split.params, { k: '', v: '' }]);
  }
  function updateParam(i: number, k: string, v: string) {
    const next = split.params.slice();
    next[i] = { k, v };
    setQueryParams(next);
  }
  function removeParam(i: number) {
    const next = split.params.slice();
    next.splice(i, 1);
    setQueryParams(next);
  }

  // ---------- Headers (stored as JSON string, edited as key-value) --------
  // The orchestrator sometimes writes `headers` as an object literal in JSON
  // (e.g. `"headers": {}`), and sometimes as a stringified JSON value (e.g.
  // `"headers": "{}"`). The executor expects a string; we handle both shapes
  // so the editor doesn't flag valid configs as invalid.

  function parseHeaders(raw: unknown): Array<{ k: string; v: string }> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({ k, v: String(v) }));
    }
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          return Object.entries(obj as Record<string, unknown>).map(([k, v]) => ({ k, v: String(v) }));
        }
      } catch { /* fall through */ }
    }
    return [];
  }
  function stringifyHeaders(rows: Array<{ k: string; v: string }>): string {
    const obj: Record<string, string> = {};
    for (const r of rows) {
      if (r.k.trim()) obj[r.k.trim()] = r.v;
    }
    return JSON.stringify(obj);
  }

  const headerRows = $derived(parseHeaders(config.headers));
  const headersAreValid = $derived.by(() => {
    const raw = config.headers;
    if (raw == null) return true;
    if (typeof raw === 'object') return true;
    if (typeof raw === 'string') {
      if (!raw.trim()) return true;
      try { JSON.parse(raw); return true; } catch { return false; }
    }
    return false;
  });

  function setHeaderRows(rows: Array<{ k: string; v: string }>) {
    onChange({ ...config, headers: stringifyHeaders(rows) });
  }
  function addHeader() { setHeaderRows([...headerRows, { k: '', v: '' }]); }
  function updateHeader(i: number, k: string, v: string) {
    const next = headerRows.slice();
    next[i] = { k, v };
    setHeaderRows(next);
  }
  function removeHeader(i: number) {
    const next = headerRows.slice();
    next.splice(i, 1);
    setHeaderRows(next);
  }

  // ---------- Body / method / auth ----------------------------------------

  const method = $derived(String(config.method ?? 'GET').toUpperCase());
  const auth = $derived(String(config.auth ?? 'none'));
  const bodyEnabled = $derived(method !== 'GET' && method !== 'HEAD');
  const bodyValid = $derived.by(() => {
    const raw = String(config.body ?? '').trim();
    if (!raw) return null; // empty is fine
    try { JSON.parse(raw); return true; } catch { return false; }
  });

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Pagination --------------------------------------------------
  // Stored as a nested `config.pagination` object (absent = off). The executor
  // auto-follows pages and concatenates each page's `itemsPath` array into
  // output.items, adding output.pages.

  const pag = $derived.by(() => {
    const p = config.pagination;
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  });
  const pagEnabled = $derived(!!pag && (pag.mode === 'cursor' || pag.mode === 'page'));
  const pagMode = $derived(String(pag?.mode ?? 'page'));

  function enablePagination(on: boolean) {
    if (on) {
      onChange({
        ...config,
        pagination: { mode: 'page', pageParam: 'page', startPage: 1, itemsPath: '', maxPages: 3 },
      });
    } else {
      const next = { ...config };
      delete next.pagination;
      onChange(next);
    }
  }
  function setPag(key: string, value: unknown) {
    const cur =
      config.pagination && typeof config.pagination === 'object' && !Array.isArray(config.pagination)
        ? (config.pagination as Record<string, unknown>)
        : {};
    onChange({ ...config, pagination: { ...cur, [key]: value } });
  }

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;
</script>

<div class="hp">
  <!-- Method & URL base -->
  <section class="hp-sec">
    <div class="hp-row hp-method-row">
      <label class="hp-field hp-field-method">
        <span class="hp-label">Method</span>
        <select value={method} onchange={(e) => set('method', (e.currentTarget as HTMLSelectElement).value)}>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
          <option value="HEAD">HEAD</option>
        </select>
      </label>
      <label class="hp-field hp-field-url">
        <span class="hp-label">URL (base, before <code>?</code>)</span>
        <input
          type="text"
          spellcheck="false"
          value={split.base}
          placeholder="https://api.example.com/v1/forecast"
          oninput={(e) => setUrlBase((e.currentTarget as HTMLInputElement).value)}
        />
        <span class="hp-hint">Templates supported: <code>{`{{input.field}}`}</code></span>
      </label>
    </div>
  </section>

  <!-- Query parameters -->
  <section class="hp-sec">
    <header class="hp-sec-hdr">
      <span class="sr-label-tight">Query parameters</span>
      <span class="hp-sec-meta">{split.params.length} {split.params.length === 1 ? 'param' : 'params'}</span>
    </header>
    {#if split.params.length === 0}
      <p class="hp-empty">No query parameters yet.</p>
    {:else}
      <div class="hp-kv-grid">
        <div class="hp-kv-head">Key</div>
        <div class="hp-kv-head">Value</div>
        <div></div>
        {#each split.params as p, i (i)}
          <input type="text" class="hp-kv-input" placeholder="key" value={p.k} oninput={(e) => updateParam(i, (e.currentTarget as HTMLInputElement).value, p.v)} />
          <input type="text" class="hp-kv-input" placeholder="value" value={p.v} oninput={(e) => updateParam(i, p.k, (e.currentTarget as HTMLInputElement).value)} />
          <button type="button" class="hp-kv-rm" onclick={() => removeParam(i)} aria-label="remove">×</button>
        {/each}
      </div>
    {/if}
    <button type="button" class="hp-add" onclick={addParam}>+ Add parameter</button>
    <p class="hp-hint">Live URL: <code class="hp-live-url">{splitUrl(String(config.url ?? '')).base ? joinUrl(split.base, split.params) : '—'}</code></p>
  </section>

  <!-- Authentication -->
  <section class="hp-sec">
    <header class="hp-sec-hdr"><span class="sr-label-tight">Authentication</span></header>
    <label class="hp-field">
      <span class="hp-label">Type</span>
      <select value={auth} onchange={(e) => set('auth', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="none">None</option>
        <option value="bearer">Bearer token</option>
        <option value="apiKey">API key header</option>
      </select>
    </label>
    {#if auth === 'bearer'}
      <label class="hp-field">
        <span class="hp-label">Bearer token</span>
        <input type="text" spellcheck="false" placeholder="{`{{secrets.MY_TOKEN}}`} or paste token" value={String(config.authToken ?? '')} oninput={(e) => set('authToken', (e.currentTarget as HTMLInputElement).value)} />
        <span class="hp-hint">Sent as <code>Authorization: Bearer &lt;token&gt;</code>. Templates supported.</span>
      </label>
    {:else if auth === 'apiKey'}
      <label class="hp-field">
        <span class="hp-label">Header name</span>
        <input type="text" placeholder="X-API-Key" value={String(config.authHeader ?? 'X-API-Key')} oninput={(e) => set('authHeader', (e.currentTarget as HTMLInputElement).value)} />
      </label>
      <label class="hp-field">
        <span class="hp-label">API key</span>
        <input type="text" spellcheck="false" placeholder="paste key or {`{{secrets.MY_KEY}}`}" value={String(config.authToken ?? '')} oninput={(e) => set('authToken', (e.currentTarget as HTMLInputElement).value)} />
      </label>
    {/if}
  </section>

  <!-- Headers -->
  <section class="hp-sec">
    <header class="hp-sec-hdr">
      <span class="sr-label-tight">Headers</span>
      {#if !headersAreValid}<span class="hp-warn">stored JSON is invalid</span>{/if}
    </header>
    {#if headerRows.length === 0}
      <p class="hp-empty">No custom headers.</p>
    {:else}
      <div class="hp-kv-grid">
        <div class="hp-kv-head">Header</div>
        <div class="hp-kv-head">Value</div>
        <div></div>
        {#each headerRows as h, i (i)}
          <input type="text" class="hp-kv-input" placeholder="Content-Type" value={h.k} oninput={(e) => updateHeader(i, (e.currentTarget as HTMLInputElement).value, h.v)} />
          <input type="text" class="hp-kv-input" placeholder="application/json" value={h.v} oninput={(e) => updateHeader(i, h.k, (e.currentTarget as HTMLInputElement).value)} />
          <button type="button" class="hp-kv-rm" onclick={() => removeHeader(i)} aria-label="remove">×</button>
        {/each}
      </div>
    {/if}
    <button type="button" class="hp-add" onclick={addHeader}>+ Add header</button>
  </section>

  <!-- Body -->
  {#if bodyEnabled}
    <section class="hp-sec">
      <header class="hp-sec-hdr">
        <span class="sr-label-tight">Request body</span>
        {#if bodyValid === true}<span class="hp-ok">JSON ✓</span>{/if}
        {#if bodyValid === false}<span class="hp-info">will send as raw text</span>{/if}
      </header>
      <textarea
        class="hp-code"
        rows="6"
        spellcheck="false"
        placeholder={`{ "name": {{input.name}}, "value": 42 }`}
        value={String(config.body ?? '')}
        oninput={(e) => set('body', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="hp-hint">Templates: <code>{`{{input.field}}`}</code>. If valid JSON, <code>Content-Type</code> defaults to <code>application/json</code>.</span>
    </section>
  {:else}
    <section class="hp-sec hp-sec-disabled">
      <header class="hp-sec-hdr"><span class="sr-label-tight">Request body</span></header>
      <p class="hp-empty">Disabled — <strong>{method}</strong> requests do not send a body.</p>
    </section>
  {/if}

  <!-- Pagination -->
  <section class="hp-sec">
    <header class="hp-sec-hdr">
      <span class="sr-label-tight">Pagination</span>
      <label class="hp-toggle">
        <input
          type="checkbox"
          checked={pagEnabled}
          onchange={(e) => enablePagination((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>{pagEnabled ? 'On' : 'Off'}</span>
      </label>
    </header>
    {#if !pagEnabled}
      <p class="hp-empty">Off — a single request is made. Enable to auto-follow pages and concatenate results.</p>
    {:else}
      <label class="hp-field">
        <span class="hp-label">Mode</span>
        <select value={pagMode} onchange={(e) => setPag('mode', (e.currentTarget as HTMLSelectElement).value)}>
          <option value="page">Page number (?page=1,2,3…)</option>
          <option value="cursor">Cursor (follow next-cursor from the response)</option>
        </select>
      </label>
      <label class="hp-field">
        <span class="hp-label">Items path</span>
        <input
          type="text"
          spellcheck="false"
          placeholder="results — dot-path to each page's array (blank = the body is the array)"
          value={String(pag?.itemsPath ?? '')}
          oninput={(e) => setPag('itemsPath', (e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      {#if pagMode === 'page'}
        <div class="hp-row">
          <label class="hp-field">
            <span class="hp-label">Page param</span>
            <input
              type="text"
              spellcheck="false"
              placeholder="page"
              value={String(pag?.pageParam ?? 'page')}
              oninput={(e) => setPag('pageParam', (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="hp-field">
            <span class="hp-label">Start page</span>
            <input
              type="number"
              min="0"
              value={Number(pag?.startPage ?? 1)}
              oninput={(e) => setPag('startPage', Number((e.currentTarget as HTMLInputElement).value))}
            />
          </label>
        </div>
      {:else}
        <label class="hp-field">
          <span class="hp-label">Cursor path (in response body)</span>
          <input
            type="text"
            spellcheck="false"
            placeholder="next_cursor  or  meta.next"
            value={String(pag?.cursorPath ?? '')}
            oninput={(e) => setPag('cursorPath', (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="hp-field">
          <span class="hp-label">Cursor query param</span>
          <input
            type="text"
            spellcheck="false"
            placeholder="cursor"
            value={String(pag?.cursorParam ?? '')}
            oninput={(e) => setPag('cursorParam', (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      {/if}
      <label class="hp-field">
        <span class="hp-label">Max pages (1–10)</span>
        <input
          type="number"
          min="1"
          max="10"
          value={Number(pag?.maxPages ?? 3)}
          oninput={(e) => setPag('maxPages', Number((e.currentTarget as HTMLInputElement).value))}
        />
      </label>
      <p class="hp-hint">
        Output gains <code>items</code> (all pages concatenated) and <code>pages</code>. Stops on an empty page, a
        missing cursor, or max pages.
      </p>
    {/if}
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="hp-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="hp-code"
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
  .hp { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .hp-preview {
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 5%, transparent);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hp-preview-hdr { display: flex; justify-content: space-between; align-items: center; }
  .hp-preview-kind {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent);
    padding: 2px 6px; border-radius: 2px;
  }
  .hp-preview-line { margin: 0; font-size: var(--fs-nav); color: var(--text-primary); line-height: 1.4; }

  .hp-sec { display: flex; flex-direction: column; gap: 8px; }
  .hp-sec-disabled { opacity: 0.55; }
  .hp-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .hp-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .hp-row { display: flex; gap: 10px; }
  .hp-method-row { align-items: flex-end; }
  .hp-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .hp-field-method { flex: 0 0 110px; }
  .hp-field-url { flex: 1; }
  .hp-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .hp-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .hp-hint code, .hp-label code { font-size: var(--fs-label); color: var(--text-muted); }
  .hp-live-url { font-size: var(--fs-label); color: var(--accent); word-break: break-all; }

  .hp-kv-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) 24px;
    gap: 4px;
  }
  .hp-kv-head {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  .hp-kv-input {
    padding: 5px 7px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
  }
  .hp-kv-input:focus { border-color: var(--text-muted); }
  .hp-kv-rm {
    background: transparent; color: var(--text-muted);
    border: 1px solid var(--card-border); cursor: pointer;
  }
  .hp-kv-rm:hover { color: var(--status-error, #c0392b); }
  .hp-add {
    align-self: flex-start;
    padding: 4px 10px;
    background: var(--bg); color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .hp-add:hover { color: var(--text-primary); }
  .hp-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }

  .hp-code {
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
  .hp-code:focus { border-color: var(--text-muted); }

  .hp-warn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-error, #c0392b); }
  .hp-ok   { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-success, #2a9d4a); }
  .hp-info { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

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

  .hp-toggle {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted); cursor: pointer;
  }
  .hp-toggle input[type='checkbox'] { width: auto; margin: 0; cursor: pointer; }

  .hp-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .hp-raw summary { cursor: pointer; }
</style>
