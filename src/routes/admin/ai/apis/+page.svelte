<svelte:head><title>API Registry — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  // The SAME predicate the server binds with. `$lib/secrets/registry` is
  // server-only, so the rule lives in a pure module both sides import — a
  // hand-written copy here previously offered `*.example.com` credentials for
  // the apex host, which the server then refused at call time.
  import { hostAllowed } from '$lib/secrets/host-match';

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
    injection: { kind: string; name?: string; field?: string; usernameField?: string; passwordField?: string };
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

  type CredField = { key: string; label: string; type: string; required: boolean; placeholder?: string; help?: string };
  type CredSpec = {
    provider: string;
    title: string;
    helpUrl?: string;
    assemble: 'single' | 'json';
    fields: CredField[];
    handle: string;
    hosts: string[];
    companions: Array<{ handle: string; hosts: string[] }>;
  };

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let integrations = $state<Integration[]>(data.integrations as Integration[]);
  let apis = $state<ApiRow[]>(data.apis as ApiRow[]);
  let secrets = $state<Secret[]>(data.secrets as Secret[]);
  const refSources = data.refSources as Array<{ key: string; label: string }>;
  const credentialSpecs = data.credentialSpecs as CredSpec[];

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
    const [i, s, a] = await Promise.all([
      fetch(qs('/api/admin/apis/integrations')).then((r) => r.json()).catch(() => null),
      fetch(qs('/api/admin/apis/secrets')).then((r) => r.json()).catch(() => null),
      fetch(qs('/api/admin/apis/catalog')).then((r) => r.json()).catch(() => null),
    ]);
    if (i?.integrations) integrations = i.integrations;
    if (s?.secrets) secrets = s.secrets;
    // Deleting or rebinding a credential changes which catalogue rows still
    // resolve, so the catalogue is re-read alongside it rather than going stale.
    if (a?.apis) apis = a.apis;
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
  let sInjKind = $state<'bearer' | 'header' | 'query' | 'basic' | 'none'>('bearer');
  let sInjName = $state('');
  /** Which field of a stored credential SET is sent (header/query), and which
   *  two make up a Basic pair. Blank = the whole stored value. */
  let sInjField = $state('');
  let sInjUserField = $state('');
  let sInjPassField = $state('');
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
    sInjKind = (s.injection.kind as 'bearer' | 'header' | 'query' | 'basic' | 'none') ?? 'bearer';
    sInjName = s.injection.name ?? '';
    sInjField = s.injection.field ?? '';
    sInjUserField = s.injection.usernameField ?? '';
    sInjPassField = s.injection.passwordField ?? '';
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
    sInjField = '';
    sInjUserField = '';
    sInjPassField = '';
    sHosts = '';
    sPaths = '';
    sMethods = 'GET, HEAD';
    sNotes = '';
    editing = false;
  }

  // ── Quick-add from the credential catalogue ─────────────────────────────
  // The generic form below can express any credential, but a multi-row one (an
  // OAuth provider's stored credential set PLUS the ref row that mints access
  // tokens from it) has to be assembled by hand in the right order, and getting
  // it wrong leaves a handle that looks registered and fails at run time. This
  // posts `{provider, fields}` to the same endpoint the jkai modal uses, so the
  // server writes every row from the code catalogue in one go.
  // `?provider=<key>` opens that provider's form straight away, so a page
  // elsewhere that needs a credential can link a novice directly to the one
  // field they have to fill rather than to a nine-field generic form. Unknown
  // values are ignored, leaving the page in its normal state.
  let quickProvider = $state(
    credentialSpecs.some((s) => s.provider === page.url.searchParams.get('provider'))
      ? (page.url.searchParams.get('provider') as string)
      : '',
  );
  let quickValues = $state<Record<string, string>>({});

  const quickSpec = $derived(credentialSpecs.find((s) => s.provider === quickProvider) ?? null);
  const quickMissing = $derived(
    (quickSpec?.fields ?? []).filter((f) => f.required && !String(quickValues[f.key] ?? '').trim()).length,
  );

  function openQuickAdd(spec: CredSpec) {
    quickProvider = spec.provider;
    quickValues = {};
  }

  function closeQuickAdd() {
    quickProvider = '';
    quickValues = {};
  }

  async function saveQuickAdd() {
    const spec = quickSpec;
    if (!spec || quickMissing) return;
    busy = 'quick';
    try {
      // The server assembles a multi-field credential set from exactly the keys
      // the catalogue declared, so a set can never gain a field here.
      const res = await fetch(qs('/api/admin/apis/secrets'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: spec.provider,
          fields: Object.fromEntries(
            spec.fields
              .map((f) => [f.key, String(quickValues[f.key] ?? '').trim()])
              .filter(([, v]) => v !== ''),
          ),
        }),
      });
      const body = await res.json();
      if (res.ok) {
        const rows = [spec.handle, ...spec.companions.map((c) => c.handle)].join(' + ');
        say(`Stored ${spec.title} — registered ${rows}`);
        closeQuickAdd();
        await refresh();
      } else say(body.error ?? 'Save failed', true);
    } finally {
      busy = null;
    }
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
          injection:
            sInjKind === 'bearer' || sInjKind === 'none'
              ? { kind: sInjKind }
              : sInjKind === 'basic'
                ? {
                    kind: 'basic',
                    usernameField: sInjUserField.trim() || 'username',
                    passwordField: sInjPassField.trim() || 'password',
                  }
                : { kind: sInjKind, name: sInjName, field: sInjField.trim() || undefined },
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

  // ── Catalogue ↔ credential binding ──────────────────────────────────────
  // The one place a service is joined to a credential. Until this existed the
  // join was writable only by jkai's `api_register` tool, so every canvas node
  // calling that API inherited a binding the owner could read but not change.
  // Nodes deliberately have no say: they pick the service, the register decides
  // the credential, and changing it here changes it for every node at once.
  function hostOf(baseUrl: string): string {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return '';
    }
  }

  /** Credentials that can actually authenticate this entry's host. */
  function boundSecrets(a: ApiRow): Secret[] {
    const host = hostOf(a.baseUrl);
    if (!host) return [];
    return secrets.filter((s) => s.injection.kind !== 'none' && hostAllowed(host, s.allowedHosts));
  }

  /**
   * The handle stored on the entry when no credential of that name is in the
   * registry any more — deleting a credential does not unbind the services
   * using it. Without this the `<select>` matches no option, the browser falls
   * back to the first one, and a broken binding reads as "no credential".
   */
  function danglingHandle(a: ApiRow): string | null {
    if (!a.secretHandle) return null;
    return secrets.some((s) => s.handle === a.secretHandle) ? null : a.secretHandle;
  }

  async function bindCredential(a: ApiRow, handle: string, el: HTMLSelectElement) {
    // Legacy `bearer-env` entries hold an env-var NAME that nothing in this UI
    // can type back in, so unbinding one destroys it for good. Refuse rather
    // than lose it; binding a real credential over it is still allowed, because
    // that is the migration we want.
    if (!handle && !a.secretHandle && a.auth !== 'none') {
      el.value = '';
      say(
        `${a.name} uses a legacy ${a.auth} reference, not a registry credential. ` +
          `Bind a credential to replace it — clearing it here would discard the env-var name with no way to restore it.`,
        true,
      );
      return;
    }
    busy = `bind:${a.key}`;
    try {
      const res = await fetch(qs('/api/admin/apis/catalog'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: a.key, handle }),
      });
      const body = await res.json();
      if (res.ok) {
        apis = apis.map((x) =>
          x.key === a.key
            ? { ...x, secretHandle: handle || undefined, auth: handle ? 'secret' : 'none' }
            : x,
        );
        say(handle ? `${a.name} now uses "${handle}"` : `${a.name} now calls unauthenticated`);
      } else {
        // The server refused (usually: that credential is not bound to this
        // host). Put the dropdown back to what is actually stored — otherwise it
        // shows a binding that does not exist.
        el.value = a.secretHandle ?? '';
        say(body.error ?? 'Could not change the credential', true);
      }
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
            <span class="nm-pill" data-state={s.available ? 'ok' : 'error'}>
              {s.available ? 'available' : 'unavailable'}
            </span>
            <span class="s-used">{s.useCount} uses · {fmtDate(s.lastUsedAt)}</span>
            <span class="s-acts">
              <button class="link-btn" onclick={() => loadSecret(s)}>edit</button>
              <button class="link-btn danger" onclick={() => removeSecret(s)} disabled={busy === `dels:${s.handle}`}>delete</button>
            </span>
          </div>
          {#if !s.available && s.unavailableReason}
            <!-- Inline, not a title tooltip. A half-registered credential reads as
                 fine at a glance and only fails when a canvas runs it, so the
                 reason has to be visible without hovering. -->
            <p class="s-why">{s.unavailableReason}</p>
          {/if}
        {/each}
      </div>
    {:else}
      <div class="nm-empty">No credentials registered. Add one below to let jkai authenticate an API.</div>
    {/if}

    {#if credentialSpecs.length && !editing}
      <div class="sform">
        <div class="nm-sec-hd"><span class="sr-label-tight">Known providers</span></div>
        <p class="sec-lede">
          These write every row the provider needs in one go — an OAuth provider stores its credential
          set <em>and</em> the handle that mints access tokens from it, correctly bound. Prefer this over
          the generic form below, where the two can be created out of order.
        </p>
        <div class="quick-row">
          {#each credentialSpecs as spec (spec.provider)}
            <button
              class="link-btn"
              class:is-on={quickProvider === spec.provider}
              onclick={() => (quickProvider === spec.provider ? closeQuickAdd() : openQuickAdd(spec))}
            >{spec.title}</button>
          {/each}
        </div>

        {#if quickSpec}
          {#key quickSpec.provider}
            <div class="quick-form">
              <p class="quick-dest">
                Writes <code>{quickSpec.handle}</code> ({quickSpec.hosts.join(', ')}){#each quickSpec.companions as c (c.handle)}
                  &nbsp;+ <code>{c.handle}</code> ({c.hosts.join(', ')}){/each}.
                {#if quickSpec.helpUrl}
                  <a href={quickSpec.helpUrl} target="_blank" rel="noopener noreferrer">Where to find these</a>.
                {/if}
              </p>
              {#each quickSpec.fields as f (f.key)}
                <label class="nm-field">
                  <span class="sr-label-tight">{f.label}{#if !f.required}<em> (optional)</em>{/if}</span>
                  <input
                    class="nm-text-input"
                    type={f.type === 'password' ? 'password' : 'text'}
                    placeholder={f.placeholder ?? ''}
                    autocomplete="off"
                    value={quickValues[f.key] ?? ''}
                    oninput={(e) => (quickValues = { ...quickValues, [f.key]: e.currentTarget.value })}
                  />
                  {#if f.help}<span class="field-help">{f.help}</span>{/if}
                </label>
              {/each}
              <div class="r-actions">
                <button class="nm-save-btn" onclick={saveQuickAdd} disabled={busy === 'quick' || quickMissing > 0}>
                  {busy === 'quick' ? 'Saving…' : `Store ${quickSpec.title}`}
                </button>
                <button class="link-btn" onclick={closeQuickAdd}>cancel</button>
              </div>
            </div>
          {/key}
        {/if}
      </div>
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
            <option value="basic">HTTP Basic — username + password from a set</option>
            <option value="none">Store only — never attached to a request</option>
          </select>
        </label>
        {#if sInjKind === 'header' || sInjKind === 'query'}
          <label class="nm-field">
            <span class="sr-label-tight">{sInjKind === 'header' ? 'Header name' : 'Parameter name'}</span>
            <input class="nm-text-input" type="text" bind:value={sInjName} placeholder={sInjKind === 'header' ? 'X-API-Key' : 'api_key'} />
          </label>
          <label class="nm-field">
            <span class="sr-label-tight">Field <em>(optional — for a credential set)</em></span>
            <input class="nm-text-input" type="text" bind:value={sInjField} placeholder="consumer_key" />
          </label>
        {/if}
        {#if sInjKind === 'basic'}
          <label class="nm-field">
            <span class="sr-label-tight">Username field</span>
            <input class="nm-text-input" type="text" bind:value={sInjUserField} placeholder="username" />
          </label>
          <label class="nm-field">
            <span class="sr-label-tight">Password field</span>
            <input class="nm-text-input" type="text" bind:value={sInjPassField} placeholder="password" />
          </label>
        {/if}
      </div>
      {#if sInjKind === 'basic' || ((sInjKind === 'header' || sInjKind === 'query') && sInjField)}
        <p class="inj-note">
          This reads a credential <em>set</em>: paste the value as a JSON object with those field names, e.g.
          <code>{'{"username":"…","password":"…"}'}</code>. Only the named field reaches the wire — the rest of
          the set stays encrypted at rest.
        </p>
      {/if}
      {#if sInjKind === 'none'}
        <p class="inj-note">
          A store-only credential is never attached to an outbound request — <code>resolveSecretForUrl</code>
          refuses it outright. Use it for a credential <em>set</em> that server code trades for something
          else, such as the <code>client_id</code> / <code>client_secret</code> / <code>refresh_token</code>
          JSON an OAuth provider's <code>*-oauth</code> row holds. Bind it to the <strong>token</strong>
          host, and paste the value as a JSON object.
        </p>
      {/if}

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
      <strong>Credential is set here and only here</strong> — canvas nodes pick the service and inherit
      whatever this row says, so changing it changes every workflow using that API at once.
    </p>
    {#if apis.length === 0}
      <div class="nm-empty">Catalogue empty — it seeds on boot.</div>
    {:else}
      <div class="rows">
        {#each apis as a (a.key)}
          {@const bound = boundSecrets(a)}
          {@const boundHandles = new Set(bound.map((s) => s.handle))}
          {@const dangling = danglingHandle(a)}
          <div class="arow">
            <span class="a-name">{a.name}</span>
            <span class="a-base"><code>{a.baseUrl}</code></span>
            <span class="a-cred">
              <select
                class="a-cred-sel"
                aria-label={`Credential for ${a.name}`}
                value={a.secretHandle ?? ''}
                disabled={busy === `bind:${a.key}`}
                onchange={(e) => bindCredential(a, e.currentTarget.value, e.currentTarget)}
              >
                <option value="">— no credential —</option>
                {#if dangling}
                  <!-- Keeps the stored binding selectable and visibly broken;
                       without it the browser silently falls back to the first
                       option and the row claims it has no credential. -->
                  <option value={dangling}>⚠ {dangling} · missing from the registry</option>
                {/if}
                {#if bound.length}
                  <optgroup label={`bound to ${hostOf(a.baseUrl) || 'this host'}`}>
                    {#each bound as s (s.handle)}
                      <option value={s.handle}>🔒 {s.handle}</option>
                    {/each}
                  </optgroup>
                {/if}
                <optgroup label="not bound to this host">
                  {#each secrets.filter((s) => !boundHandles.has(s.handle)) as s (s.handle)}
                    <option value={s.handle} disabled={s.injection.kind === 'none'}>
                      {s.handle}
                      {s.injection.kind === 'none' ? '· store-only' : `· ${s.allowedHosts.join(', ') || 'no hosts'}`}
                    </option>
                  {/each}
                </optgroup>
              </select>
              {#if !a.secretHandle && a.auth !== 'none'}
                <span class="a-legacy" title="Legacy env-var reference — replace it with a registry credential">{a.auth}</span>
              {/if}
            </span>
            <span class="nm-pill" data-state={a.status === 'verified' ? 'ok' : a.status === 'broken' ? 'error' : 'info'}>{a.status}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</PageWrap>

<style>
  .flash { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); margin: 0 0 0.6rem; }
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
  .r-call, .r-outs { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .r-by { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .r-detail { padding: 0.2rem 0.5rem 0.9rem; }
  .r-desc { font-size: 0.85rem; color: var(--text-muted); margin: 0 0 0.5rem; }
  .r-dl { display: grid; grid-template-columns: 8rem 1fr; gap: 0.3rem 0.8rem; margin: 0; font-size: 0.8rem; }
  .r-dl dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-ghost); }
  .r-dl dd { margin: 0; color: var(--text-muted); overflow-wrap: anywhere; }
  .r-actions { display: flex; align-items: center; gap: 0.7rem; margin-top: 0.8rem; flex-wrap: wrap; }
  .test-out { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

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
  .arow { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 13rem) auto; }
  .s-hosts, .s-inj, .s-hint, .s-used, .a-base { font-family: var(--font-mono); font-size: var(--fs-label-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s-label, .a-name { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s-acts { display: flex; gap: 0.5rem; }

  .a-cred { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
  .a-cred-sel {
    flex: 1; min-width: 0;
    padding: 0.25rem 0.3rem;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--divider);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
  }
  .a-cred-sel:disabled { opacity: 0.5; }
  .a-legacy { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); white-space: nowrap; }

  .sform { margin-top: 1rem; padding-top: 0.6rem; border-top: 1px dashed var(--divider); display: flex; flex-direction: column; gap: 0.5rem; }

  /* Why a credential is unavailable — read at a glance, not on hover. */
  .s-why {
    margin: 0; padding: 0.35rem 0 0.6rem 0.2rem;
    border-bottom: 1px solid var(--divider);
    font-size: 0.78rem; line-height: 1.5; color: var(--error);
  }

  .inj-note { margin: 0; font-size: 0.78rem; line-height: 1.55; color: var(--text-muted); }
  .inj-note code { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-primary); }
  .inj-note strong { color: var(--text-primary); }

  .quick-row { display: flex; flex-wrap: wrap; gap: 0.9rem; }
  .link-btn.is-on { color: var(--accent); }
  .quick-form { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.4rem; }
  .quick-dest { margin: 0; font-size: 0.78rem; line-height: 1.55; color: var(--text-muted); }
  .quick-dest code { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-primary); }
  .quick-dest a { color: var(--accent); }
  .field-help { font-size: 0.75rem; line-height: 1.45; color: var(--text-muted); }

  .link-btn {
    background: none; border: 0; padding: 0;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--text-muted); cursor: pointer; text-decoration: underline;
  }
  .link-btn:hover { color: var(--text-primary); }
  .link-btn.danger, .danger-btn { color: var(--error); }
  .danger-btn {
    background: none;
    border: 1px solid var(--error);
    padding: 0.35rem 0.7rem;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    cursor: pointer;
  }
  .danger-btn:disabled { opacity: 0.5; cursor: default; }

  @media (max-width: 900px) {
    .row-main { grid-template-columns: 1fr auto; }
    .r-call, .r-outs, .r-by { display: none; }
    .srow { grid-template-columns: 1fr auto; }
    .s-hosts, .s-inj, .s-hint, .s-used, .s-label { display: none; }
    .arow { grid-template-columns: 1fr minmax(0, 9rem) auto; }
    .a-base { display: none; }
    .r-dl { grid-template-columns: 1fr; }
  }
</style>
