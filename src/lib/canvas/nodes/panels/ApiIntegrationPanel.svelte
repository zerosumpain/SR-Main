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

  type Param = {
    name: string;
    in: 'path' | 'query' | 'body' | 'header';
    required?: boolean;
    description?: string;
    example?: string;
    default?: string;
  };
  type Output = { name: string; expr: string; unit?: string; description?: string };
  type Integration = {
    key: string;
    name: string;
    description?: string;
    api: string;
    host: string;
    baseUrl: string;
    method: string;
    path: string;
    params: Param[];
    outputs: Output[];
    status: string;
    lastTestedAt?: string;
    lastTestSummary?: string;
    authKind: string;
    secretHandle?: string;
    writes: boolean;
    docsUrl?: string;
  };

  let integrations = $state<Integration[]>([]);
  let loadError = $state<string | null>(null);
  let loading = $state(true);

  onMount(async () => {
    try {
      const res = await fetch('/api/workflows/api-integrations');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      integrations = (body.integrations ?? []) as Integration[];
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load the integration register';
    } finally {
      loading = false;
    }
  });

  const selectedKey = $derived(String(config.integration ?? ''));
  const selected = $derived(integrations.find((i) => i.key === selectedKey) ?? null);
  const params = $derived((config.params ?? {}) as Record<string, unknown>);

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function setParam(name: string, value: string) {
    onChange({ ...config, params: { ...params, [name]: value } });
  }

  /**
   * Selecting an integration reseeds `params` with just that integration's
   * parameters (pre-filled with any defaults), so a leftover param from a
   * previously-selected integration is never silently sent.
   */
  function pick(key: string) {
    const next = integrations.find((i) => i.key === key);
    const seeded: Record<string, string> = {};
    for (const p of next?.params ?? []) seeded[p.name] = p.default || '';
    onChange({ ...config, integration: key, params: seeded, confirmWrite: false });
  }

  const urlPreview = $derived.by(() => {
    if (!selected) return '';
    const base = selected.baseUrl || '';
    let p = selected.path || '';
    // Show the {placeholder} filled in when the user has typed a value.
    p = p.replace(/\{([A-Za-z0-9_.-]+)\}/g, (m, n: string) => String(params[n] ?? '') || m);
    if (!p) return base;
    const withSlash = base.endsWith('/') ? base : base + '/';
    const composed = withSlash + p.replace(/^\/+/, '');
    const qs = (selected.params ?? [])
      .filter((x) => x.in === 'query' && String(params[x.name] ?? '') !== '')
      .map((x) => `${encodeURIComponent(x.name)}=${encodeURIComponent(String(params[x.name]))}`)
      .join('&');
    return qs ? `${composed}${composed.includes('?') ? '&' : '?'}${qs}` : composed;
  });

  const needsWriteConfirm = $derived(!!selected?.writes);
</script>

<div class="ai">
  <p class="ai-lead">
    Call a <strong>registered integration</strong> by name. Parameters below come from the register —
    the response arrives as <strong>named values</strong>, so downstream nodes can use
    <code>{'{{input.values.name}}'}</code> instead of digging through JSON. Values support
    <code>{'{{input.field}}'}</code> templates.
  </p>

  {#if loadError}
    <p class="ai-err">Could not load the register: {loadError}</p>
  {/if}

  <section class="ai-sec">
    <header class="ai-sec-hdr"><span class="sr-label-tight">Integration</span></header>
    {#if loading}
      <p class="ai-hint">Loading register…</p>
    {:else if integrations.length === 0 && !loadError}
      <p class="ai-hint">
        No integrations recorded yet. Ask jkai in <a href="/jkai">/jkai</a> for the data you want — it
        researches the API, tests the call and records it here — or add one at
        <a href="/admin/ai/apis">/admin/ai/apis</a>. You can still type a key below.
      </p>
      <input
        type="text"
        class="ai-text"
        placeholder="integration key (e.g. openrouter-credit-balance)"
        value={selectedKey}
        oninput={(e) => set('integration', (e.currentTarget as HTMLInputElement).value)}
      />
    {:else}
      <select
        class="ai-select"
        value={selected?.key ?? ''}
        onchange={(e) => pick((e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="" disabled>— choose a registered integration —</option>
        {#each integrations as i (i.key)}
          <option value={i.key}>{i.name} · {i.method} {i.host}{i.status !== 'verified' ? ` · ${i.status}` : ''}</option>
        {/each}
      </select>
      {#if selectedKey && !selected}
        <p class="ai-hint">
          <code>{selectedKey}</code> isn't in the loaded register — it will be resolved at run time (or
          the call will fail if it isn't recorded).
        </p>
      {/if}
    {/if}
  </section>

  {#if selected}
    <section class="ai-sec ai-detail">
      <header class="ai-sec-hdr">
        <span class="sr-label-tight">{selected.name}</span>
        <span class="ai-badges">
          <span class="ai-badge">{selected.method}</span>
          {#if selected.secretHandle}
            <span class="ai-badge" title="Credential injected server-side; never visible here">🔒 {selected.secretHandle}</span>
          {/if}
          <span class="ai-badge ai-status-{selected.status}">{selected.status}</span>
        </span>
      </header>
      {#if selected.description}<p class="ai-hint">{selected.description}</p>{/if}
      {#if urlPreview}
        <p class="ai-preview"><span class="ai-preview-label">{selected.method}</span> <code>{urlPreview}</code></p>
      {/if}
      {#if selected.lastTestSummary}
        <p class="ai-hint">Last test: {selected.lastTestSummary}{selected.lastTestedAt ? ` · ${new Date(selected.lastTestedAt).toLocaleString('en-GB')}` : ''}</p>
      {/if}
    </section>

    {#if selected.params.length}
      <section class="ai-sec">
        <header class="ai-sec-hdr"><span class="sr-label-tight">Parameters</span></header>
        {#each selected.params as p (p.name)}
          <div class="ai-field">
            <label class="ai-label" for={`ai-param-${p.name}`}>
              {p.name}
              {#if p.required}<span class="ai-req">required</span>{/if}
              <span class="ai-in">{p.in}</span>
            </label>
            <input
              id={`ai-param-${p.name}`}
              type="text"
              class="ai-text"
              placeholder={p.example || p.default || `{{input.${p.name}}}`}
              value={String(params[p.name] ?? '')}
              oninput={(e) => setParam(p.name, (e.currentTarget as HTMLInputElement).value)}
            />
            {#if p.description}<p class="ai-hint">{p.description}</p>{/if}
          </div>
        {/each}
      </section>
    {:else}
      <p class="ai-hint">This integration takes no parameters — just wire it up and run.</p>
    {/if}

    {#if selected.outputs.length}
      <section class="ai-sec">
        <header class="ai-sec-hdr"><span class="sr-label-tight">Outputs available downstream</span></header>
        <ul class="ai-outs">
          {#each selected.outputs as o (o.name)}
            <li>
              <code>{`{{input.values.${o.name}}}`}</code>
              {#if o.unit}<span class="ai-unit">{o.unit}</span>{/if}
              {#if o.description}<span class="ai-odesc">— {o.description}</span>{/if}
            </li>
          {/each}
        </ul>
        <p class="ai-hint">
          The raw response is also available as <code>{'{{input.json}}'}</code>. In a Conditional node
          use e.g. <code>input.values.{selected.outputs[0].name} &lt; 10</code>.
        </p>
      </section>
    {/if}

    {#if needsWriteConfirm}
      <section class="ai-sec ai-warn">
        <header class="ai-sec-hdr"><span class="sr-label-tight">This integration writes</span></header>
        <p class="ai-hint">
          <code>{selected.method}</code> changes data on {selected.host}. The call is refused unless you
          allow it here.
        </p>
        <label class="ai-check">
          <input
            type="checkbox"
            checked={config.confirmWrite === true}
            onchange={(e) => set('confirmWrite', (e.currentTarget as HTMLInputElement).checked)}
          />
          Allow this workflow to perform the write
        </label>
      </section>
    {/if}
  {/if}

  <p class="ai-hint ai-foot">
    Manage the register and its credentials at <a href="/admin/ai/apis">/admin/ai/apis</a>. Key values
    are never shown here or sent to the browser.
  </p>

  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />
</div>

<style>
  .ai { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .ai-lead { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
  .ai-lead strong { color: var(--text-primary); }
  .ai-lead code, .ai-hint code, .ai-preview code, .ai-outs code { font-size: 11px; color: var(--text-muted); }
  .ai-err { margin: 0; font-size: 12px; color: var(--status-error, #c0392b); }

  .ai-sec { display: flex; flex-direction: column; gap: 8px; }
  .ai-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .ai-text, .ai-select {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 12px;
    box-sizing: border-box;
    outline: none;
  }
  .ai-text:focus, .ai-select:focus { border-color: var(--text-muted); }

  .ai-hint { font-size: 11px; color: var(--text-ghost); margin: 0; line-height: 1.4; }
  .ai-hint a { color: var(--text-muted); }
  .ai-foot { border-top: 1px dashed var(--card-border); padding-top: 8px; }

  .ai-detail { border: 1px solid var(--card-border); padding: 8px; gap: 6px; }
  .ai-badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .ai-badge {
    font-family: var(--font-mono); font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-ghost);
    border: 1px solid var(--card-border);
    padding: 0 4px;
  }
  .ai-status-verified { color: var(--status-success, #2a9d4a); border-color: currentColor; }
  .ai-status-broken { color: var(--status-error, #c0392b); border-color: currentColor; }
  .ai-status-draft { color: var(--text-muted); }

  .ai-preview { margin: 0; font-size: 11px; line-height: 1.4; word-break: break-all; }
  .ai-preview-label { font-family: var(--font-mono); font-size: 9px; color: var(--accent-ink, var(--text-muted)); margin-right: 4px; }

  .ai-field { display: flex; flex-direction: column; gap: 4px; }
  .ai-label {
    display: flex; align-items: center; gap: 6px;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .ai-req { color: var(--status-error, #c0392b); font-size: 9px; }
  .ai-in { color: var(--text-ghost); font-size: 9px; }

  .ai-outs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
  .ai-unit { color: var(--text-ghost); font-size: 10px; margin-left: 4px; }
  .ai-odesc { color: var(--text-ghost); }

  .ai-warn { border: 1px solid var(--status-error, #c0392b); padding: 8px; }
  .ai-check { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-primary); }
</style>
