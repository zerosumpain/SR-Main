<svelte:head><title>Scraper — Admin</title></svelte:head>
<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data } = $props();

  let credentials = $state(data.credentials);
  let runs = $state(data.recentRuns);
  let targetKnowledge = $state(data.targetKnowledge ?? []);
  let profiles = $state<string[]>([]);

  type Tab = 'credentials' | 'profiles' | 'knowledge' | 'sessions' | 'runs' | 'test';
  let tab = $state<Tab>('credentials');

  // ── Credentials form ──
  let newDomain = $state('');
  let newLabel = $state('');
  let newLoginUrl = $state('');
  let newStrategy = $state<'form' | 'script' | 'cookie'>('form');
  let newCredentialJson = $state('{"username":"","password":""}');
  let addError = $state<string | null>(null);
  let addBusy = $state(false);

  // ── Target knowledge form ──
  let tkDomain = $state('');
  let tkRequiresInteractive = $state(false);
  let tkHint = $state('');
  let tkNotes = $state('');
  let tkBusy = $state(false);
  let tkError = $state<string | null>(null);

  // ── Ad-hoc test ──
  const EXAMPLE_JOB = JSON.stringify({
    url: 'https://www.civilservicejobs.service.gov.uk/csr/index.cgi?SID=c2VhcmNoc29ydD1jbG9zaW5n',
    profile: 'civilservicejobs-gov-uk',
    waitFor: { type: 'selector', selector: 'div.search_result', timeoutMs: 15000 },
    extract: [{ field: 'title', selector: 'div.search_result h3 a', multi: true }],
    pacing: { minMs: 2500, maxMs: 5000 },
  }, null, 2);

  let testJobJson = $state(EXAMPLE_JOB);
  let testResult = $state<any>(null);
  let testRunning = $state(false);
  let testError = $state<string | null>(null);

  $effect(() => {
    fetch('/api/scraper/profiles')
      .then(r => r.json())
      .then(ps => { profiles = ps; })
      .catch(() => {});
  });

  async function addCredential() {
    addError = null;
    let cred: unknown;
    try { cred = JSON.parse(newCredentialJson); }
    catch (e: any) { addError = 'Credential JSON invalid: ' + e.message; return; }
    addBusy = true;
    try {
      const res = await fetch('/api/scraper/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: newDomain, label: newLabel,
          loginUrl: newLoginUrl || undefined,
          loginStrategy: newStrategy, credential: cred,
        }),
      });
      if (!res.ok) { addError = 'Save failed: ' + res.status; return; }
      const list = await fetch('/api/scraper/credentials').then(r => r.json());
      credentials = list;
      newDomain = newLabel = newLoginUrl = '';
      newCredentialJson = '{"username":"","password":""}';
    } finally {
      addBusy = false;
    }
  }

  async function deleteCredential(id: number) {
    if (!confirm('Delete this credential?')) return;
    await fetch(`/api/scraper/credentials?id=${id}`, { method: 'DELETE' });
    credentials = credentials.filter((c: any) => c.id !== id);
  }

  async function clearProfile(name: string) {
    if (!confirm(`Clear profile "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/scraper/profiles?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    profiles = profiles.filter(p => p !== name);
  }

  async function addTargetKnowledge() {
    tkError = null;
    if (!tkDomain.trim()) { tkError = 'Domain is required.'; return; }
    tkBusy = true;
    try {
      const res = await fetch('/api/scraper/target-knowledge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: tkDomain.trim(),
          requiresInteractive: tkRequiresInteractive,
          interactiveHint: tkHint.trim() || undefined,
          notes: tkNotes.trim() || undefined,
          source: 'manual',
        }),
      });
      if (!res.ok) { tkError = 'Save failed: ' + res.status; return; }
      const list = await fetch('/api/scraper/target-knowledge').then(r => r.json());
      targetKnowledge = list;
      tkDomain = tkHint = tkNotes = '';
      tkRequiresInteractive = false;
    } finally {
      tkBusy = false;
    }
  }

  async function deleteTargetKnowledge(id: number) {
    if (!confirm('Delete this knowledge row?')) return;
    await fetch(`/api/scraper/target-knowledge?id=${id}`, { method: 'DELETE' });
    targetKnowledge = targetKnowledge.filter((r: any) => r.id !== id);
  }

  async function runTest() {
    testError = null;
    testResult = null;
    let job: unknown;
    try { job = JSON.parse(testJobJson); }
    catch (e: any) { testError = 'JSON invalid: ' + e.message; return; }
    testRunning = true;
    try {
      const res = await fetch('/api/scraper/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(job),
      });
      testResult = await res.json();
    } catch (e: any) {
      testError = e.message;
    } finally {
      testRunning = false;
    }
  }

  function trunc(s: string | null | undefined, n: number): string {
    if (!s) return '—';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function fmtDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ── Interactive sessions ──
  type InteractiveSession = {
    sessionId: string;
    profile: string;
    url: string;
    wsPort: number;
    vncUrl: string;
    startedAt: string;
    expiresAt: string;
  };

  let sessions = $state<InteractiveSession[]>([]);
  let sessionProfile = $state('');
  let sessionUrl = $state('');
  let sessionLaunching = $state(false);
  let sessionError = $state<string | null>(null);

  let modal = $state<{ session: InteractiveSession } | null>(null);
  let modalEnding = $state(false);

  async function fetchSessions() {
    try {
      const res = await fetch('/api/scraper/interactive');
      if (res.ok) sessions = await res.json();
    } catch {}
  }

  $effect(() => {
    fetchSessions();
    const timer = setInterval(fetchSessions, 10_000);
    return () => clearInterval(timer);
  });

  async function launchSession() {
    sessionError = null;
    if (!sessionProfile.trim() || !sessionUrl.trim()) {
      sessionError = 'Profile and starting URL are required.';
      return;
    }
    sessionLaunching = true;
    try {
      const res = await fetch('/api/scraper/interactive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: sessionProfile.trim(), url: sessionUrl.trim() }),
      });
      if (!res.ok) { sessionError = 'Launch failed: ' + res.status; return; }
      const s: InteractiveSession = await res.json();
      sessions = [s, ...sessions.filter(x => x.sessionId !== s.sessionId)];
      modal = { session: s };
    } catch (e: any) {
      sessionError = e.message;
    } finally {
      sessionLaunching = false;
    }
  }

  async function endSession(sessionId: string) {
    modalEnding = true;
    try {
      await fetch(`/api/scraper/interactive/${sessionId}`, { method: 'DELETE' });
      sessions = sessions.filter(s => s.sessionId !== sessionId);
      if (modal?.session.sessionId === sessionId) modal = null;
    } finally {
      modalEnding = false;
    }
  }

  function onModalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') modal = null;
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Channels"
    title="Scraper"
    sub="Stealth Playwright runner. Manage credentials, browser profiles, target knowledge, and interactive (noVNC) sessions."
  />

  <div class="nm-tabs">
    <button class="nm-tab" class:active={tab === 'credentials'} onclick={() => (tab = 'credentials')}>Credentials <span class="nm-tab-count">{credentials.length}</span></button>
    <button class="nm-tab" class:active={tab === 'profiles'} onclick={() => (tab = 'profiles')}>Profiles <span class="nm-tab-count">{profiles.length}</span></button>
    <button class="nm-tab" class:active={tab === 'knowledge'} onclick={() => (tab = 'knowledge')}>Target Knowledge <span class="nm-tab-count">{targetKnowledge.length}</span></button>
    <button class="nm-tab" class:active={tab === 'sessions'} onclick={() => (tab = 'sessions')}>Sessions <span class="nm-tab-count">{sessions.length}</span></button>
    <button class="nm-tab" class:active={tab === 'runs'} onclick={() => (tab = 'runs')}>Runs <span class="nm-tab-count">{runs.length}</span></button>
    <button class="nm-tab" class:active={tab === 'test'} onclick={() => (tab = 'test')}>Ad-hoc test</button>
  </div>

  {#if tab === 'credentials'}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Saved credentials</span><span class="nm-sec-meta">{credentials.length}</span></div>
      {#if credentials.length === 0}
        <div class="nm-empty">No credentials saved.</div>
      {:else}
        <table class="nm-table">
          <thead>
            <tr><th>Domain</th><th>Label</th><th>Strategy</th><th>Login URL</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {#each credentials as c}
              <tr>
                <td>{c.domain}</td>
                <td>{c.label}</td>
                <td><code>{c.loginStrategy}</code></td>
                <td>{trunc(c.loginUrl, 50)}</td>
                <td>{fmtDate(c.createdAt)}</td>
                <td><button class="nm-link-btn danger" onclick={() => deleteCredential(c.id)}>Delete</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Add credential</span></div>
      <div class="nm-form-row">
        <label class="nm-field">
          <span class="sr-label-tight">Domain</span>
          <input class="nm-text-input" type="text" placeholder="example.gov.uk" bind:value={newDomain} />
        </label>
        <label class="nm-field">
          <span class="sr-label-tight">Label</span>
          <input class="nm-text-input" type="text" bind:value={newLabel} />
        </label>
      </div>
      <div class="nm-form-row">
        <label class="nm-field">
          <span class="sr-label-tight">Login URL <em>— optional</em></span>
          <input class="nm-text-input" type="text" bind:value={newLoginUrl} />
        </label>
        <label class="nm-field">
          <span class="sr-label-tight">Strategy</span>
          <select class="nm-select" bind:value={newStrategy}>
            <option value="form">form</option>
            <option value="script">script</option>
            <option value="cookie">cookie</option>
          </select>
        </label>
      </div>
      <label class="nm-field">
        <span class="sr-label-tight">Credential JSON</span>
        <textarea class="nm-textarea" rows="4" bind:value={newCredentialJson}></textarea>
      </label>
      {#if addError}<div class="banner banner-error">{addError}</div>{/if}
      <button class="nm-save-btn" onclick={addCredential} disabled={addBusy}>
        {addBusy ? '…' : 'Save credential'}
      </button>
    </section>
  {/if}

  {#if tab === 'profiles'}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Browser profiles on disk</span><span class="nm-sec-meta">{profiles.length}</span></div>
      {#if profiles.length === 0}
        <div class="nm-empty">No profiles. They are created on first run.</div>
      {:else}
        <ul class="profile-list">
          {#each profiles as name}
            <li>
              <code>{name}</code>
              <button class="nm-link-btn danger" onclick={() => clearProfile(name)}>Clear profile</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if tab === 'knowledge'}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Target knowledge</span><span class="nm-sec-meta">{targetKnowledge.length}</span></div>
      <p class="muted">Per-domain scraping intelligence used by the orchestrator when planning workflows. Auto-populated from failures; manually extend here.</p>
      {#if targetKnowledge.length === 0}
        <div class="nm-empty">No knowledge rows yet.</div>
      {:else}
        <table class="nm-table">
          <thead>
            <tr><th>Domain</th><th>Interactive</th><th>Hint</th><th>Source</th><th>Updated</th><th></th></tr>
          </thead>
          <tbody>
            {#each targetKnowledge as row}
              <tr>
                <td>{row.domain}</td>
                <td>{row.requiresInteractive ? '✓' : '—'}</td>
                <td>{trunc(row.interactiveHint, 60)}</td>
                <td>{row.source}</td>
                <td>{fmtDate(row.updatedAt)}</td>
                <td><button class="nm-link-btn danger" onclick={() => deleteTargetKnowledge(row.id)}>Delete</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Add knowledge row</span></div>
      <div class="nm-form-row">
        <label class="nm-field">
          <span class="sr-label-tight">Domain</span>
          <input class="nm-text-input" type="text" placeholder="example.gov.uk" bind:value={tkDomain} />
        </label>
        <label class="nm-field check">
          <input type="checkbox" bind:checked={tkRequiresInteractive} />
          <span>Requires interactive session</span>
        </label>
      </div>
      <label class="nm-field">
        <span class="sr-label-tight">Interactive hint <em>— optional</em></span>
        <input class="nm-text-input" type="text" bind:value={tkHint} />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Notes <em>— optional</em></span>
        <textarea class="nm-textarea" rows="3" bind:value={tkNotes}></textarea>
      </label>
      {#if tkError}<div class="banner banner-error">{tkError}</div>{/if}
      <button class="nm-save-btn" onclick={addTargetKnowledge} disabled={tkBusy}>
        {tkBusy ? '…' : 'Save row'}
      </button>
    </section>
  {/if}

  {#if tab === 'sessions'}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Launch interactive session</span></div>
      <p class="muted">Use when a target site needs a human to solve a CAPTCHA / log in. Cookies persist in the profile so subsequent headless scrapes ride the same session.</p>
      <div class="nm-form-row">
        <label class="nm-field">
          <span class="sr-label-tight">Profile</span>
          <input class="nm-text-input" type="text" placeholder="civilservicejobs-gov-uk" bind:value={sessionProfile} />
        </label>
        <label class="nm-field">
          <span class="sr-label-tight">Starting URL</span>
          <input class="nm-text-input" type="text" placeholder="https://example.com/login" bind:value={sessionUrl} />
        </label>
      </div>
      {#if sessionError}<div class="banner banner-error">{sessionError}</div>{/if}
      <button class="nm-save-btn" onclick={launchSession} disabled={sessionLaunching}>
        {sessionLaunching ? '…' : 'Launch session'}
      </button>
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Active sessions</span><span class="nm-sec-meta">{sessions.length}</span></div>
      {#if sessions.length === 0}
        <div class="nm-empty">No active sessions.</div>
      {:else}
        <table class="nm-table">
          <thead>
            <tr><th>Profile</th><th>URL</th><th>Started</th><th>Expires</th><th></th></tr>
          </thead>
          <tbody>
            {#each sessions as s}
              <tr>
                <td>{s.profile}</td>
                <td>{trunc(s.url, 50)}</td>
                <td>{s.startedAt ? new Date(s.startedAt).toLocaleTimeString('en-GB') : '—'}</td>
                <td>{s.expiresAt ? new Date(s.expiresAt).toLocaleTimeString('en-GB') : '—'}</td>
                <td>
                  <button class="nm-link-btn" onclick={() => { modal = { session: s }; }}>Open</button>
                  <span class="dot">·</span>
                  <button class="nm-link-btn danger" onclick={() => endSession(s.sessionId)}>End</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}

  {#if tab === 'runs'}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Recent runs</span><span class="nm-sec-meta">{runs.length}</span></div>
      {#if runs.length === 0}
        <div class="nm-empty">No runs logged yet.</div>
      {:else}
        <table class="nm-table">
          <thead>
            <tr><th>URL</th><th>Profile</th><th>Started</th><th>Ended</th><th>OK</th><th>Pages</th><th>Error</th></tr>
          </thead>
          <tbody>
            {#each runs as r}
              <tr>
                <td>{trunc(r.url, 60)}</td>
                <td>{r.profile}</td>
                <td>{r.startedAt ? new Date(r.startedAt).toLocaleString('en-GB') : '—'}</td>
                <td>{r.endedAt ? new Date(r.endedAt).toLocaleString('en-GB') : '—'}</td>
                <td><span class="nm-pill" data-state={r.success ? 'success' : 'error'}>{r.success ? '✓' : '✗'}</span></td>
                <td>{r.pagesLoaded}</td>
                <td class="err-cell">{trunc(r.error, 100)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}

  {#if tab === 'test'}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Ad-hoc ScrapeJob</span></div>
      <p class="muted">Supports all ScrapeJob fields: <code>url</code>, <code>profile</code>, <code>waitFor</code>, <code>extract</code>, <code>pagination</code>, <code>credentialId</code>, <code>pacing</code>.</p>
      <textarea class="nm-textarea" rows="14" bind:value={testJobJson}></textarea>
      {#if testError}<div class="banner banner-error">{testError}</div>{/if}
      <button class="nm-btn-ghost" onclick={runTest} disabled={testRunning}>
        {testRunning ? 'Running…' : 'Run test'}
      </button>
      {#if testResult !== null}
        <pre class="code">{JSON.stringify(testResult, null, 2)}</pre>
      {/if}
    </section>
  {/if}
</PageWrap>

<!-- noVNC modal -->
{#if modal}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div role="dialog" aria-modal="true" onkeydown={onModalKeydown} class="modal-scrim">
    <div class="modal-panel">
      <div class="modal-hd">
        <span class="modal-title">{modal.session.profile}</span>
        <a class="nm-btn-ghost" href={modal.session.vncUrl} target="_blank" rel="noopener">Open in new tab ↗</a>
        <button class="nm-link-btn danger" onclick={() => endSession(modal!.session.sessionId)} disabled={modalEnding}>
          {modalEnding ? '…' : 'End session'}
        </button>
        <button class="nm-btn-ghost" onclick={() => { modal = null; }}>Close</button>
      </div>
      <iframe src={modal.session.vncUrl} title="noVNC — {modal.session.profile}" allow="clipboard-read; clipboard-write"></iframe>
    </div>
  </div>
{/if}

<style>
  .muted { margin: 0; font-size: 0.85rem; color: var(--text-secondary); }
  .muted code, code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
  }
  .nm-field.check {
    align-self: end;
    flex-direction: row;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
  }
  .profile-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--divider);
  }
  .profile-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.55rem 0.4rem;
    border-bottom: 1px solid var(--divider);
  }
  .err-cell { color: #c44; max-width: 320px; word-break: break-word; }
  .dot { color: var(--text-ghost); margin: 0 0.4rem; }

  .code {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.7rem;
    margin: 0.5rem 0 0;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .modal-scrim {
    position: fixed; inset: 0; z-index: 60;
    display: flex; flex-direction: column;
    background: rgba(26, 16, 8, 0.55);
    backdrop-filter: blur(2px);
  }
  .modal-panel {
    margin: auto;
    width: min(calc(100vw - 2rem), 1280px);
    background: var(--bg);
    border: 1px solid var(--card-border);
    display: flex;
    flex-direction: column;
    min-height: 70vh;
    max-height: calc(100vh - 3rem);
    overflow: hidden;
  }
  .modal-hd {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--divider);
    background: var(--bg-section);
  }
  .modal-title {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
  }
  iframe {
    flex: 1;
    width: 100%;
    border: 0;
    min-height: 0;
  }
</style>
