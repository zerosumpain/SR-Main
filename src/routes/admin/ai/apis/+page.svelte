<svelte:head><title>API Registry — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  type Param = { name: string; in: string; required?: boolean; description?: string; example?: string; default?: string };
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
    lastTestStatus?: string;
    lastTestSummary?: string;
    createdBy: string;
    authKind: string;
    secretHandle?: string;
    writes: boolean;
    docsUrl?: string;
  };
  type ApiRow = { key: string; name: string; baseUrl: string; auth: string; secretHandle?: string; status: string; description: string };
  type Secret = {
    handle: string;
    label: string;
    source: string;
    refKey?: string;
    injection: { kind: string; name?: string };
    allowedHosts: string[];
    allowedPathPrefixes: string[];
    allowedMethods: string[];
    hint?: string;
    notes?: string;
    available: boolean;
    unavailableReason?: string;
    lastUsedAt?: string;
    useCount: number;
  };

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let integrations = $state<Integration[]>(data.integrations as Integration[]);
  let apis = $state<ApiRow[]>(data.apis as ApiRow[]);
  let secrets = $state<Secret[]>(data.secrets as Secret[]);
  const refSources = data.refSources as Array<{ key: string; label: string }>;

  let expanded = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let msg = $state('');
  let msgBad = $state(false);
  let testResult = $state<Record<string, string>>({});

  function qs(path: string, extra = ''): string {
    const t = adminToken ? `token=${adminToken}` : '';
    const parts = [t, extra].filter(Boolean).join('&');
    return parts ? `${path}?${parts}` : path;
  }

  function say(text: string, bad = false) {
    msg = text;
    msgBad = bad;
    setTimeout(() => (msg = ''), 5000);
  }

  async function refresh() {
    const [i, s] = await Promise.all([
      fetch(qs('/api/admin/apis/integrations')).then((r) => r.json()).catch(() => null),
      fetch(qs('/api/admin/apis/secrets')).then((r) => r.json()).catch(() => null),
    ]);
    if (i?.integrations) integrations = i.integrations;
    if (s?.secrets) secrets = s.secrets;
  }

  // ── Integrations ────────────────────────────────────────────────────────
  async function testIntegration(row: Integration) {
    busy = `test:${row.key}`;
    testResult = { ...testResult, [row.key]: 'Running…' };
    try {
      const params: Record<string, string> = {};
      for (const p of row.params) if (p.example || p.default) params[p.name] = p.example || p.default || '';
      const res = await fetch(qs('/api/admin/apis/integrations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', key: row.key, params, confirmWrite: false }),
      });
      const body = await res.json();
      if (body.result?.success) {
        const vals = Object.entries(body.result.values ?? {})
          .filter(([k]) => !k.endsWith('_error'))
          .map(([k, v]) => `${k} = ${typeof v === 'number' ? v : JSON.stringify(v)}`)
          .join(' · ');
        testResult = { ...testResult, [row.key]: `HTTP ${body.result.status} — ${vals || 'no named outputs'}` };
      } else {
        testResult = { ...testResult, [row.key]: `Failed: ${body.result?.error ?? body.error ?? 'unknown error'}` };
      }
      await refresh();
    } catch (e) {
      testResult = { ...testResult, [row.key]: `Network error: ${e instanceof Error ? e.message : ''}` };
    } finally {
      busy = null;
    }
  }

  async function removeIntegration(row: Integration) {
    if (!confirm(`Delete the "${row.name}" integration? The API and its credentials stay.`)) return;
    busy = `del:${row.key}`;
    try {
      const res = await fetch(qs('/api/admin/apis/integrations', `key=${encodeURIComponent(row.key)}`), { method: 'DELETE' });
      if (res.ok) {
        integrations = integrations.filter((i) => i.key !== row.key);
        say(`Deleted "${row.name}"`);
      } else say((await res.json()).error ?? 'Delete failed', true);
    } finally {
      busy = null;
    }
  }

  // ── Credentials ─────────────────────────────────────────────────────────
  let sHandle = $state('');
  let sLabel = $state('');
  let sSource = $state<'ref' | 'vault'>('vault');
  let sValue = $state('');
  let sRefKey = $state(refSources[0]?.key ?? '');
  let sInjKind = $state<'bearer' | 'header' | 'query'>('bearer');
  let sInjName = $state('');
  let sHosts = $state('');
  let sPaths = $state('');
  let sMethods = $state('GET, HEAD');
  let sNotes = $state('');
  let editing = $state(false);

  function loadSecret(s: Secret) {
    sHandle = s.handle;
    sLabel = s.label;
    sSource = s.source === 'ref' ? 'ref' : 'vault';
    sValue = '';
    sRefKey = s.refKey ?? refSources[0]?.key ?? '';
    sInjKind = (s.injection.kind as 'bearer' | 'header' | 'query') ?? 'bearer';
    sInjName = s.injection.name ?? '';
    sHosts = s.allowedHosts.join(', ');
    sPaths = s.allowedPathPrefixes.join(', ');
    sMethods = (s.allowedMethods ?? ['GET', 'HEAD']).join(', ');
    sNotes = s.notes ?? '';
    editing = true;
  }

  function resetSecretForm() {
    sHandle = '';
    sLabel = '';
    sSource = 'vault';
    sValue = '';
    sRefKey = refSources[0]?.key ?? '';
    sInjKind = 'bearer';
    sInjName = '';
    sHosts = '';
    sPaths = '';
    sMethods = 'GET, HEAD';
    sNotes = '';
    editing = false;
  }

  async function saveSecret() {
    busy = 'secret';
    try {
      const res = await fetch(qs('/api/admin/apis/secrets'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: sHandle,
          label: sLabel || sHandle,
          source: sSource,
          value: sSource === 'vault' && sValue ? sValue : undefined,
          refKey: sSource === 'ref' ? sRefKey : undefined,
          injection: sInjKind === 'bearer' ? { kind: 'bearer' } : { kind: sInjKind, name: sInjName },
          allowedHosts: sHosts.split(',').map((h) => h.trim()).filter(Boolean),
          allowedPathPrefixes: sPaths.split(',').map((p) => p.trim()).filter(Boolean),
          allowedMethods: sMethods.split(',').map((m) => m.trim().toUpperCase()).filter(Boolean),
          notes: sNotes,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        say(`Saved credential "${body.secret.handle}"`);
        sValue = '';
        resetSecretForm();
        await refresh();
      } else say(body.error ?? 'Save failed', true);
    } finally {
      busy = null;
    }
  }

  async function removeSecret(s: Secret) {
    if (!confirm(`Delete credential "${s.handle}"? Any API using it will stop authenticating.`)) return;
    busy = `dels:${s.handle}`;
    try {
      const res = await fetch(qs('/api/admin/apis/secrets', `handle=${encodeURIComponent(s.handle)}`), { method: 'DELETE' });
      if (res.ok) {
        secrets = secrets.filter((x) => x.handle !== s.handle);
        say(`Deleted "${s.handle}"`);
      } else say((await res.json()).error ?? 'Delete failed', true);
    } finally {
      busy = null;
    }
  }

  function fmtDate(d?: string): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  const verifiedCount = $derived(integrations.filter((i) => i.status === 'verified').length);
</script>

<PageWrap>
  <PageHeader
    kicker="AI"
    title="API Registry"
    sub="Every external API jkai can reach, the named operations it has recorded, and the credentials it can use but never read. Integrations are reusable from chat and from the “API integration” canvas node."
  />

  {#if msg}
    <p class="flash" class:bad={msgBad}>{msg}</p>
  {/if}

  <!-- ── Integrations ──────────────────────────────────────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Integrations</span>
      <span class="nm-sec-meta">{integrations.length} recorded · {verifiedCount} verified</span>
    </div>

    {#if integrations.length === 0}
      <div class="nm-empty">
        Nothing recorded yet. Ask jkai for external data in <a href="/jkai">/jkai</a> — it researches the
        API, tests the call and records it here.
      </div>
    {:else}
      <div class="rows">
        {#each integrations as row (row.key)}
          <div class="row" class:open={expanded === row.key}>
            <button class="row-main" onclick={() => (expanded = expanded === row.key ? null : row.key)}>
              <span class="r-name">
                {row.name}
                {#if row.writes}<span class="nm-pill" data-state="warn">writes</span>{/if}
              </span>
              <span class="r-call"><b>{row.method}</b> {row.host}{row.path}</span>
              <span class="r-outs">
                {#if row.outputs.length}{row.outputs.map((o) => o.name).join(', ')}{:else}—{/if}
              </span>
              <span class="nm-pill" data-state={row.status === 'verified' ? 'ok' : row.status === 'broken' ? 'error' : 'info'}>
                {row.status}
              </span>
              <span class="r-by">{row.createdBy}</span>
            </button>

            {#if expanded === row.key}
              <div class="r-detail">
                {#if row.description}<p class="r-desc">{row.description}</p>{/if}
                <dl class="r-dl">
                  <dt>Request</dt>
                  <dd><code>{row.method} {row.baseUrl}{row.path}</code></dd>
                  <dt>API</dt>
                  <dd><code>{row.api}</code></dd>
                  <dt>Credential</dt>
                  <dd>
                    {#if row.secretHandle}
                      <code>🔒 {row.secretHandle}</code> — injected server-side, never shown
                    {:else}
                      none ({row.authKind})
                    {/if}
                  </dd>
                  {#if row.params.length}
                    <dt>Parameters</dt>
                    <dd>
                      {#each row.params as p (p.name)}
                        <div><code>{p.name}</code> <span class="dim">{p.in}{p.required ? ' · required' : ''}</span>{#if p.description} — {p.description}{/if}</div>
                      {/each}
                    </dd>
                  {/if}
                  {#if row.outputs.length}
                    <dt>Outputs</dt>
                    <dd>
                      {#each row.outputs as o (o.name)}
                        <div><code>{o.name}</code> <span class="dim">= {o.expr}</span>{#if o.unit} <span class="dim">({o.unit})</span>{/if}</div>
                      {/each}
                    </dd>
                  {/if}
                  <dt>Last test</dt>
                  <dd>{row.lastTestSummary ?? '—'} <span class="dim">{fmtDate(row.lastTestedAt)}</span></dd>
                  {#if row.docsUrl}
                    <dt>Docs</dt>
                    <dd><a href={row.docsUrl} target="_blank" rel="noreferrer">{row.docsUrl}</a></dd>
                  {/if}
                </dl>

                <div class="r-actions">
                  <button class="nm-save-btn" onclick={() => testIntegration(row)} disabled={busy === `test:${row.key}` || row.writes}>
                    {busy === `test:${row.key}` ? 'Testing…' : row.writes ? 'Test disabled (writes)' : 'Test now'}
                  </button>
                  <button class="danger-btn" onclick={() => removeIntegration(row)} disabled={busy === `del:${row.key}`}>
                    Delete
                  </button>
                  {#if testResult[row.key]}<span class="test-out">{testResult[row.key]}</span>{/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Credentials ───────────────────────────────────────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Credentials jkai can use but not read</span>
      <span class="nm-sec-meta">{secrets.length}</span>
    </div>
    <p class="sec-lede">
      jkai sees only the <em>handle</em> and the hosts each credential is allowed to authenticate. Values
      are write-only: they are never returned by any endpoint, never shown here, and are scrubbed out of
      API responses before the model sees them. <strong>The host list is the security boundary</strong> —
      a credential is only ever sent to a host you list, so a compromised or prompt-injected agent cannot
      redirect it elsewhere.
    </p>

    {#if secrets.length}
      <div class="rows">
        {#each secrets as s (s.handle)}
          <div class="srow">
            <span class="s-handle"><code>{s.handle}</code></span>
            <span class="s-label">{s.label}</span>
            <span class="s-hosts">{s.allowedHosts.join(', ')}{#if s.allowedPathPrefixes.length}<span class="dim"> · {s.allowedPathPrefixes.join(', ')}</span>{/if}</span>
            <span class="s-inj">{s.injection.kind}{s.injection.name ? `:${s.injection.name}` : ''} · {(s.allowedMethods ?? ['GET','HEAD']).join('/')}</span>
            <span class="s-hint">{s.source === 'ref' ? `ref:${s.refKey}` : s.hint ? `…${s.hint}` : 'stored'}</span>
            <span class="nm-pill" data-state={s.available ? 'ok' : 'error'} title={s.unavailableReason ?? ''}>
              {s.available ? 'available' : 'unavailable'}
            </span>
            <span class="s-used">{s.useCount} uses · {fmtDate(s.lastUsedAt)}</span>
            <span class="s-acts">
              <button class="link-btn" onclick={() => loadSecret(s)}>edit</button>
              <button class="link-btn danger" onclick={() => removeSecret(s)} disabled={busy === `dels:${s.handle}`}>delete</button>
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="nm-empty">No credentials registered. Add one below to let jkai authenticate an API.</div>
    {/if}

    <div class="sform">
      <div class="nm-sec-hd"><span class="sr-label-tight">{editing ? `Edit “${sHandle}”` : 'Add a credential'}</span></div>
      <div class="nm-form-row">
        <label class="nm-field">
          <span class="sr-label-tight">Handle</span>
          <input class="nm-text-input" type="text" bind:value={sHandle} placeholder="openrouter" readonly={editing} />
        </label>
        <label class="nm-field">
          <span class="sr-label-tight">Label</span>
          <input class="nm-text-input" type="text" bind:value={sLabel} placeholder="OpenRouter API key" />
        </label>
      </div>

      <div class="nm-form-row">
        <label class="nm-field">
          <span class="sr-label-tight">Source</span>
          <select class="nm-text-input" bind:value={sSource}>
            <option value="vault">Store a value here (encrypted, this host only)</option>
            <option value="ref">Point at a key the site already has</option>
          </select>
        </label>
        {#if sSource === 'vault'}
          <label class="nm-field">
            <span class="sr-label-tight">Value {#if editing}<em>(blank = keep existing)</em>{/if}</span>
            <input class="nm-text-input" type="password" bind:value={sValue} placeholder="paste the key — never shown again" autocomplete="off" />
          </label>
        {:else}
          <label class="nm-field">
            <span class="sr-label-tight">Existing key</span>
            <select class="nm-text-input" bind:value={sRefKey}>
              {#each refSources as r (r.key)}<option value={r.key}>{r.label}</option>{/each}
            </select>
          </label>
        {/if}
      </div>

      <div class="nm-form-row">
        <label class="nm-field">
          <span class="sr-label-tight">How it is sent</span>
          <select class="nm-text-input" bind:value={sInjKind}>
            <option value="bearer">Authorization: Bearer &lt;key&gt;</option>
            <option value="header">Custom header</option>
            <option value="query">Query parameter</option>
          </select>
        </label>
        {#if sInjKind !== 'bearer'}
          <label class="nm-field">
            <span class="sr-label-tight">{sInjKind === 'header' ? 'Header name' : 'Parameter name'}</span>
            <input class="nm-text-input" type="text" bind:value={sInjName} placeholder={sInjKind === 'header' ? 'X-API-Key' : 'api_key'} />
          </label>
        {/if}
      </div>

      <label class="nm-field">
        <span class="sr-label-tight">Allowed hosts <em>(comma separated — required)</em></span>
        <input class="nm-text-input" type="text" bind:value={sHosts} placeholder="openrouter.ai, *.openrouter.ai" />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Allowed path prefixes <em>(optional — least privilege)</em></span>
        <input class="nm-text-input" type="text" bind:value={sPaths} placeholder="/api/v1/credits, /api/v1/key" />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Allowed methods <em>(blank = read-only GET, HEAD)</em></span>
        <input class="nm-text-input" type="text" bind:value={sMethods} placeholder="GET, HEAD" />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Notes <em>(optional)</em></span>
        <input class="nm-text-input" type="text" bind:value={sNotes} placeholder="what this key is for" />
      </label>

      <div class="r-actions">
        <button class="nm-save-btn" onclick={saveSecret} disabled={busy === 'secret' || !sHandle || !sHosts}>
          {busy === 'secret' ? 'Saving…' : editing ? 'Update credential' : 'Add credential'}
        </button>
        {#if editing}<button class="link-btn" onclick={resetSecretForm}>cancel</button>{/if}
      </div>
    </div>
  </section>

  <!-- ── Catalogue ─────────────────────────────────────────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">API catalogue</span>
      <span class="nm-sec-meta">{apis.length}</span>
    </div>
    <p class="sec-lede">
      The hosts jkai is allowed to call at all. Every request is kept within the entry's base URL and
      SSRF-guarded. Grown by the nightly improvement engine and by jkai itself (<code>api_register</code>).
    </p>
    {#if apis.length === 0}
      <div class="nm-empty">Catalogue empty — it seeds on boot.</div>
    {:else}
      <div class="rows">
        {#each apis as a (a.key)}
          <div class="arow">
            <span class="a-name">{a.name}</span>
            <span class="a-base"><code>{a.baseUrl}</code></span>
            <span class="a-auth">
              {#if a.secretHandle}🔒 {a.secretHandle}{:else}{a.auth}{/if}
            </span>
            <span class="nm-pill" data-state={a.status === 'verified' ? 'ok' : a.status === 'broken' ? 'error' : 'info'}>{a.status}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</PageWrap>

<style>
  .flash { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin: 0 0 0.6rem; }
  .flash.bad { color: var(--error); }
  .sec-lede { font-size: 0.82rem; color: var(--text-muted); line-height: 1.55; margin: 0 0 0.7rem; }
  .sec-lede strong { color: var(--text-primary); }
  .dim { color: var(--text-ghost); }

  .rows { display: flex; flex-direction: column; border-top: 1px solid var(--divider); }

  .row { border-bottom: 1px solid var(--divider); }
  .row-main {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.4fr) minmax(0, 0.9fr) auto auto;
    align-items: center;
    gap: 0.85rem;
    width: 100%;
    padding: 0.7rem 0.5rem;
    background: none;
    border: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .row-main:hover { background: var(--accent-tint-08); }
  .r-name { font-size: 0.92rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem; }
  .r-call, .r-outs { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .r-by { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }

  .r-detail { padding: 0.2rem 0.5rem 0.9rem; }
  .r-desc { font-size: 0.85rem; color: var(--text-muted); margin: 0 0 0.5rem; }
  .r-dl { display: grid; grid-template-columns: 8rem 1fr; gap: 0.3rem 0.8rem; margin: 0; font-size: 0.8rem; }
  .r-dl dt { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-ghost); }
  .r-dl dd { margin: 0; color: var(--text-muted); overflow-wrap: anywhere; }
  .r-actions { display: flex; align-items: center; gap: 0.7rem; margin-top: 0.8rem; flex-wrap: wrap; }
  .test-out { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }

  .srow, .arow {
    display: grid;
    align-items: center;
    gap: 0.7rem;
    padding: 0.6rem 0.5rem;
    border-bottom: 1px solid var(--divider);
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .srow { grid-template-columns: 8rem minmax(0, 1fr) minmax(0, 1.3fr) 7rem 6rem auto minmax(0, 9rem) auto; }
  .arow { grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) 9rem auto; }
  .s-hosts, .s-inj, .s-hint, .s-used, .a-base, .a-auth { font-family: var(--font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s-label, .a-name { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s-acts { display: flex; gap: 0.5rem; }

  .sform { margin-top: 1rem; padding-top: 0.6rem; border-top: 1px dashed var(--divider); display: flex; flex-direction: column; gap: 0.5rem; }

  .link-btn {
    background: none; border: 0; padding: 0;
    font-family: var(--font-mono); font-size: 11px;
    color: var(--text-muted); cursor: pointer; text-decoration: underline;
  }
  .link-btn:hover { color: var(--text-primary); }
  .link-btn.danger, .danger-btn { color: var(--error); }
  .danger-btn {
    background: none;
    border: 1px solid var(--error);
    padding: 0.35rem 0.7rem;
    font-family: var(--font-mono); font-size: 11px;
    cursor: pointer;
  }
  .danger-btn:disabled { opacity: 0.5; cursor: default; }

  @media (max-width: 900px) {
    .row-main { grid-template-columns: 1fr auto; }
    .r-call, .r-outs, .r-by { display: none; }
    .srow { grid-template-columns: 1fr auto; }
    .s-hosts, .s-inj, .s-hint, .s-used, .s-label { display: none; }
    .arow { grid-template-columns: 1fr auto; }
    .a-base, .a-auth { display: none; }
    .r-dl { grid-template-columns: 1fr; }
  }
</style>
