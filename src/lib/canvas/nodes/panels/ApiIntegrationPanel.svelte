<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ResourcePicker from './shared/ResourcePicker.svelte';

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

  /**
   * The picker owns the fetch (loading / retry / empty / custom-value fall out
   * of it); the detail block below reads the same list out of `integrations`.
   */
  async function fetchIntegrations() {
    const res = await fetch('/api/workflows/api-integrations');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    integrations = (body.integrations ?? []) as Integration[];
    return integrations.map((i) => ({
      value: i.key,
      label: i.name,
      meta: `${i.method} ${i.host}${i.status !== 'verified' ? ` · ${i.status}` : ''}`,
    }));
  }

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
   * previously-selected integration is never silently sent. A key that is not
   * in the register (typed by hand, or a {{template}}) leaves `params` alone —
   * there is nothing to reseed from, and wiping them would silently discard
   * values the user typed for it.
   */
  function pick(key: string) {
    const next = integrations.find((i) => i.key === key);
    if (!next) {
      onChange({ ...config, integration: key });
      return;
    }
    const seeded: Record<string, string> = {};
    for (const p of next.params) seeded[p.name] = p.default || '';
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

  <section class="ai-sec">
    <header class="ai-sec-hdr"><span class="sr-label-tight">Integration</span></header>
    <ResourcePicker
      value={selectedKey}
      fetcher={fetchIntegrations}
      onChange={pick}
      placeholder="choose a registered integration"
      emptyHint="Nothing recorded yet — ask jkai in /jkai for the data you want, or add one at /admin/ai/apis. You can still type a key."
    />
    {#if selectedKey && !selected}
      <p class="ai-hint">
        <code>{selectedKey}</code> isn't in the loaded register — it will be resolved at run time (or
        the call will fail if it isn't recorded).
      </p>
    {/if}

    <!-- Credential: read-only. It belongs to the API this integration sits on,
         and is set in the register — one home for the binding, so a node can
         never disagree with what /admin/ai/apis says it uses. -->
    {#if selected}
      <p class="ai-cred">
        {#if selected.secretHandle}
          <span class="ai-cred-lock">🔒</span> Uses credential <code>{selected.secretHandle}</code>,
          injected server-side.
        {:else if selected.authKind === 'none'}
          No credential bound to <code>{selected.api}</code> — this call goes out unauthenticated.
        {:else}
          Legacy <code>{selected.authKind}</code> auth on <code>{selected.api}</code>.
        {/if}
        <a href="/admin/ai/apis" target="_blank" rel="noreferrer">change in the API register</a>
      </p>
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
  .ai-lead { margin: 0; font-size: var(--fs-label); color: var(--text-muted); line-height: 1.5; }
  .ai-lead strong { color: var(--text-primary); }
  .ai-lead code, .ai-hint code, .ai-preview code, .ai-outs code, .ai-cred code { font-size: var(--fs-label); color: var(--text-muted); }

  .ai-cred { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); line-height: 1.5; }
  .ai-cred code { color: var(--text-primary); }
  .ai-cred a { color: var(--text-muted); margin-left: 4px; }
  .ai-cred-lock { margin-right: 2px; }

  .ai-sec { display: flex; flex-direction: column; gap: 8px; }
  .ai-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .ai-text {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
  }
  .ai-text:focus { border-color: var(--text-muted); }

  .ai-hint { font-size: var(--fs-label); color: var(--text-ghost); margin: 0; line-height: 1.4; }
  .ai-hint a { color: var(--text-muted); }
  .ai-foot { border-top: 1px dashed var(--card-border); padding-top: 8px; }

  .ai-detail { border: 1px solid var(--card-border); padding: 8px; gap: 6px; }
  .ai-badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .ai-badge {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-ghost);
    border: 1px solid var(--card-border);
    padding: 0 4px;
  }
  .ai-status-verified { color: var(--status-success, #2a9d4a); border-color: currentColor; }
  .ai-status-broken { color: var(--status-error, #c0392b); border-color: currentColor; }
  .ai-status-draft { color: var(--text-muted); }

  .ai-preview { margin: 0; font-size: var(--fs-label); line-height: 1.4; word-break: break-all; }
  .ai-preview-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink, var(--text-muted)); margin-right: 4px; }

  .ai-field { display: flex; flex-direction: column; gap: 4px; }
  .ai-label {
    display: flex; align-items: center; gap: 6px;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .ai-req { color: var(--status-error, #c0392b); font-size: var(--fs-label-xs); }
  .ai-in { color: var(--text-ghost); font-size: var(--fs-label-xs); }

  .ai-outs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: var(--fs-label); }
  .ai-unit { color: var(--text-ghost); font-size: var(--fs-label-xs); margin-left: 4px; }
  .ai-odesc { color: var(--text-ghost); }

  .ai-warn { border: 1px solid var(--status-error, #c0392b); padding: 8px; }
  .ai-check { display: flex; align-items: center; gap: 6px; font-size: var(--fs-label); color: var(--text-primary); }
</style>
