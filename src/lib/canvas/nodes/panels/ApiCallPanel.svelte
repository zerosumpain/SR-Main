<script lang="ts">
  import { onMount } from 'svelte';
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
  void definition;

  type ApiMeta = {
    key: string;
    name: string;
    baseUrl: string;
    description: string;
    capabilities: string[];
    tags: string[];
    auth: string;
    status: string;
    exampleRequests: Array<{ label?: string; method?: string; url: string; body?: unknown }>;
  };

  let apis = $state<ApiMeta[]>([]);
  let loadError = $state<string | null>(null);
  let loading = $state(true);

  onMount(async () => {
    try {
      const res = await fetch('/api/workflows/apis');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      apis = (body.apis ?? []) as ApiMeta[];
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load the API catalogue';
    } finally {
      loading = false;
    }
  });

  const METHODS = [
    { value: 'GET', label: 'Read / pull (GET)', hint: 'Fetch data' },
    { value: 'POST', label: 'Create / push (POST)', hint: 'Send new data' },
    { value: 'PUT', label: 'Replace / update (PUT)', hint: 'Replace a resource' },
    { value: 'PATCH', label: 'Update fields (PATCH)', hint: 'Change some fields' },
    { value: 'DELETE', label: 'Delete (DELETE)', hint: 'Remove a resource' },
  ];

  const apiKey = $derived(String(config.api ?? ''));
  const method = $derived(String(config.method ?? 'GET').toUpperCase());
  const path = $derived(String(config.path ?? ''));
  const hasBody = $derived(method !== 'GET' && method !== 'HEAD');

  // The API may be selected by key OR name (both are accepted by the executor).
  const selected = $derived(
    apis.find((a) => a.key === apiKey || a.name.toLowerCase() === apiKey.toLowerCase()) ?? null,
  );

  // Live full-URL preview so the user can see exactly what will be called.
  const urlPreview = $derived.by(() => {
    if (!selected) return '';
    const base = selected.baseUrl;
    const p = path.trim();
    if (!p) return base;
    if (/^https?:\/\//i.test(p)) return p;
    const withSlash = base.endsWith('/') ? base : base + '/';
    return withSlash + p.replace(/^\/+/, '');
  });

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function pickApi(key: string) {
    set('api', key);
  }

  function useExample(ex: { method?: string; url: string; body?: unknown }) {
    if (!selected) return;
    // Derive a path relative to the API's baseUrl from the example URL.
    let p = ex.url;
    if (p.startsWith(selected.baseUrl)) p = p.slice(selected.baseUrl.length) || '/';
    const next: Record<string, unknown> = { ...config, api: selected.key, path: p };
    if (ex.method) next.method = ex.method.toUpperCase();
    if (ex.body !== undefined) next.body = typeof ex.body === 'string' ? ex.body : JSON.stringify(ex.body, null, 2);
    onChange(next);
  }

  let showRawJson = $state(false);
</script>

<div class="ac">
  <p class="ac-lead">
    Read / write / update / <strong>push &amp; pull</strong> from any API in the catalogue. Pick an
    API, choose an operation, and give a path — auth is injected server-side and every request stays
    within the API's base URL. Fields support <code>{'{{input.field}}'}</code> templates.
  </p>

  {#if loadError}
    <p class="ac-err">Could not load the catalogue: {loadError}</p>
  {/if}

  <!-- API picker -->
  <section class="ac-sec">
    <header class="ac-sec-hdr"><span class="sr-label-tight">API</span></header>
    {#if loading}
      <p class="ac-hint">Loading catalogue…</p>
    {:else if apis.length === 0 && !loadError}
      <p class="ac-hint">
        No APIs in the catalogue yet. They are seeded on the self-improvement engine's first run, or
        you can add one from /jkai / the API tools (api_register). You can still type a key below.
      </p>
      <input
        type="text"
        class="ac-text"
        placeholder="api key or name (e.g. open-meteo)"
        value={apiKey}
        oninput={(e) => set('api', (e.currentTarget as HTMLInputElement).value)}
      />
    {:else}
      <select
        class="ac-select"
        value={selected?.key ?? ''}
        onchange={(e) => pickApi((e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="" disabled>— choose a registered API —</option>
        {#each apis as a (a.key)}
          <option value={a.key}>{a.name}{a.status && a.status !== 'seeded' ? ` · ${a.status}` : ''}</option>
        {/each}
      </select>
      {#if apiKey && !selected}
        <p class="ac-hint">
          <code>{apiKey}</code> isn't in the loaded catalogue — it will be resolved at run time (or
          the call will fail if it isn't registered).
        </p>
      {/if}
    {/if}
  </section>

  {#if selected}
    <section class="ac-sec ac-detail">
      <header class="ac-sec-hdr">
        <span class="sr-label-tight">{selected.name}</span>
        <span class="ac-badges">
          <span class="ac-badge">auth: {selected.auth}</span>
          <span class="ac-badge ac-status-{selected.status}">{selected.status}</span>
        </span>
      </header>
      {#if selected.description}<p class="ac-hint">{selected.description}</p>{/if}
      <p class="ac-base"><span class="ac-base-label">base</span> <code>{selected.baseUrl}</code></p>
      {#if selected.capabilities.length}
        <div class="ac-chips">
          {#each selected.capabilities.slice(0, 8) as cap (cap)}<span class="ac-chip">{cap}</span>{/each}
        </div>
      {/if}
      {#if selected.exampleRequests.length}
        <details class="ac-examples">
          <summary><span class="sr-label-tight">Example requests ({selected.exampleRequests.length})</span></summary>
          <ul class="ac-ex-list">
            {#each selected.exampleRequests.slice(0, 6) as ex, i (i)}
              <li>
                <button type="button" class="ac-ex" onclick={() => useExample(ex)} title="Use this example">
                  <span class="ac-ex-method">{(ex.method ?? 'GET').toUpperCase()}</span>
                  <span class="ac-ex-url">{ex.label ?? ex.url}</span>
                  <span class="ac-ex-use">use →</span>
                </button>
              </li>
            {/each}
          </ul>
        </details>
      {/if}
    </section>
  {/if}

  <!-- Operation -->
  <section class="ac-sec">
    <header class="ac-sec-hdr"><span class="sr-label-tight">Operation</span></header>
    <select class="ac-select" value={method} onchange={(e) => set('method', (e.currentTarget as HTMLSelectElement).value)}>
      {#each METHODS as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
    </select>
  </section>

  <!-- Path -->
  <section class="ac-sec">
    <header class="ac-sec-hdr"><span class="sr-label-tight">Path</span></header>
    <textarea
      class="ac-code"
      rows="2"
      spellcheck="false"
      placeholder={'/v1/forecast?latitude={{input.lat}}&longitude={{input.lon}}'}
      value={path}
      oninput={(e) => set('path', (e.currentTarget as HTMLTextAreaElement).value)}
    ></textarea>
    {#if urlPreview}
      <p class="ac-preview"><span class="ac-preview-label">{method}</span> <code>{urlPreview}</code></p>
    {:else}
      <p class="ac-hint">Path is appended to the API's base URL. Leave blank to call the base URL itself.</p>
    {/if}
  </section>

  <!-- Body (write methods only) -->
  {#if hasBody}
    <section class="ac-sec">
      <header class="ac-sec-hdr"><span class="sr-label-tight">Body (JSON)</span></header>
      <textarea
        class="ac-code"
        rows="5"
        spellcheck="false"
        placeholder={'{\n  "name": "{{input.name}}"\n}'}
        value={String(config.body ?? '')}
        oninput={(e) => set('body', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <p class="ac-hint">Sent for {method}. String values support <code>{'{{input.field}}'}</code> templates.</p>
    </section>
  {/if}

  <!-- Advanced -->
  <details class="ac-adv">
    <summary><span class="sr-label-tight">Advanced — query params &amp; headers</span></summary>
    <section class="ac-sec">
      <header class="ac-sec-hdr"><span class="sr-label-tight">Query params (JSON)</span></header>
      <textarea
        class="ac-code"
        rows="3"
        spellcheck="false"
        placeholder={'{ "limit": 10 }'}
        value={String(config.query ?? '')}
        oninput={(e) => set('query', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <p class="ac-hint">Merged into the URL. Blank/null values are skipped.</p>
    </section>
    <section class="ac-sec">
      <header class="ac-sec-hdr"><span class="sr-label-tight">Extra headers (JSON)</span></header>
      <textarea
        class="ac-code"
        rows="3"
        spellcheck="false"
        placeholder={'{ "Accept": "application/json" }'}
        value={String(config.headers ?? '')}
        oninput={(e) => set('headers', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <p class="ac-hint">Auth headers are added automatically from the catalogue entry.</p>
    </section>
  </details>

  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <details class="ac-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="ac-code"
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
  .ac { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .ac-lead { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
  .ac-lead strong { color: var(--text-primary); }
  .ac-lead code, .ac-hint code, .ac-preview code, .ac-base code { font-size: 11px; color: var(--text-muted); }
  .ac-err { margin: 0; font-size: 12px; color: var(--status-error, #c0392b); }

  .ac-sec { display: flex; flex-direction: column; gap: 8px; }
  .ac-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .ac-text, .ac-code, .ac-select {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 12px;
    box-sizing: border-box;
    outline: none;
  }
  .ac-code { font-size: 11px; padding: 8px; resize: vertical; }
  .ac-text:focus, .ac-code:focus, .ac-select:focus { border-color: var(--text-muted); }

  .ac-hint { font-size: 11px; color: var(--text-ghost); margin: 0; line-height: 1.4; }

  .ac-detail { border: 1px solid var(--card-border); padding: 8px; gap: 6px; }
  .ac-badges { display: flex; gap: 6px; }
  .ac-badge {
    font-family: var(--font-mono); font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-ghost);
    border: 1px solid var(--card-border);
    padding: 0 4px;
  }
  .ac-status-verified { color: var(--status-success, #2a9d4a); border-color: currentColor; }
  .ac-status-broken { color: var(--status-error, #c0392b); border-color: currentColor; }
  .ac-status-candidate { color: var(--text-muted); }

  .ac-base { margin: 0; font-size: 11px; }
  .ac-base-label { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; color: var(--text-ghost); margin-right: 4px; }

  .ac-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .ac-chip {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--card-border) 18%, transparent);
    padding: 1px 6px;
  }

  .ac-examples { margin-top: 2px; }
  .ac-examples summary { cursor: pointer; }
  .ac-ex-list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  .ac-ex {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    padding: 4px 6px; background: transparent; border: 1px solid transparent;
    color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; cursor: pointer;
  }
  .ac-ex:hover { border-color: var(--card-border); background: color-mix(in srgb, var(--card-border) 12%, transparent); }
  .ac-ex-method { color: var(--text-ghost); font-size: 9px; flex-shrink: 0; width: 44px; }
  .ac-ex-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .ac-ex-use { color: var(--text-ghost); font-size: 10px; flex-shrink: 0; }

  .ac-preview { margin: 0; font-size: 11px; line-height: 1.4; word-break: break-all; }
  .ac-preview-label { font-family: var(--font-mono); font-size: 9px; color: var(--accent-ink, var(--text-muted)); margin-right: 4px; }

  .ac-adv, .ac-raw { border-top: 1px dashed var(--card-border); padding-top: 8px; display: flex; flex-direction: column; gap: 12px; }
  .ac-adv summary, .ac-raw summary { cursor: pointer; }
</style>
