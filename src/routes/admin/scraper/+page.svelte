<svelte:head><title>Scraper — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let credentials = $state(data.credentials);
  let runs = $state(data.recentRuns);
  let profiles = $state<string[]>([]);

  let newDomain = $state('');
  let newLabel = $state('');
  let newLoginUrl = $state('');
  let newStrategy = $state<'form' | 'script' | 'cookie'>('form');
  let newCredentialJson = $state('{"username":"","password":""}');
  let addError = $state<string | null>(null);
  let addBusy = $state(false);

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

  function formatDate(d: Date | string | null): string {
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

  // Modal state
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

  function iframeUrl(s: InteractiveSession): string {
    return `${location.protocol}//${location.hostname}:${s.wsPort}${s.vncUrl}`;
  }

  async function launchSession() {
    sessionError = null;
    if (!sessionProfile.trim() || !sessionUrl.trim()) {
      sessionError = 'Profile and Starting URL are required.';
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

<div class="max-w-3xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-10">
    <a href="/admin?token={adminToken}" class="back-link back-link--xs">Admin</a>
    <h1 class="text-[10px] uppercase tracking-[0.3em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
      Scraper
    </h1>
    <span></span>
  </div>

  <!-- ── Credentials ── -->
  <section class="mb-10">
    <p class="text-[9px] uppercase tracking-[0.25em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">Credentials</p>

    {#if credentials.length === 0}
      <p class="text-sm mb-4" style="color: var(--text-muted);">No credentials saved.</p>
    {:else}
      <div class="rounded-xl border mb-6 overflow-x-auto" style="background: var(--card-bg); border-color: var(--card-border);">
        <table class="w-full text-[10px]" style="font-family: var(--font-mono); color: var(--text-secondary);">
          <thead>
            <tr style="border-bottom: 1px solid var(--divider);">
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">Domain</th>
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">Label</th>
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">Strategy</th>
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">Login URL</th>
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each credentials as c}
              <tr style="border-bottom: 1px solid var(--divider);">
                <td class="px-4 py-2">{c.domain}</td>
                <td class="px-4 py-2" style="color: var(--text-primary);">{c.label}</td>
                <td class="px-4 py-2">{c.loginStrategy}</td>
                <td class="px-4 py-2" style="color: var(--text-ghost);">{trunc(c.loginUrl, 40)}</td>
                <td class="px-4 py-2">{formatDate(c.createdAt)}</td>
                <td class="px-4 py-2">
                  <button
                    onclick={() => deleteCredential(c.id)}
                    class="px-2 py-0.5 rounded text-[9px]"
                    style="color: #8b3a1a; border: 1px solid #8b3a1a;"
                  >Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <!-- Add credential form -->
    <div class="rounded-xl border p-4 space-y-3" style="background: var(--card-bg); border-color: var(--card-border);">
      <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Add credential</p>
      <div class="flex gap-2">
        <input type="text" placeholder="Domain (e.g. example.gov.uk)" bind:value={newDomain}
          class="flex-1 px-2 py-1 rounded text-[11px]"
          style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body); outline: none;" />
        <input type="text" placeholder="Label" bind:value={newLabel}
          class="flex-1 px-2 py-1 rounded text-[11px]"
          style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body); outline: none;" />
      </div>
      <div class="flex gap-2">
        <input type="text" placeholder="Login URL (optional)" bind:value={newLoginUrl}
          class="flex-1 px-2 py-1 rounded text-[11px]"
          style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body); outline: none;" />
        <select bind:value={newStrategy}
          class="px-2 py-1 rounded text-[11px]"
          style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono); outline: none;">
          <option value="form">form</option>
          <option value="script">script</option>
          <option value="cookie">cookie</option>
        </select>
      </div>
      <textarea bind:value={newCredentialJson} rows="3" placeholder='&#123;"username":"","password":""&#125;'
        class="w-full px-2 py-1 rounded text-[10px] resize-none"
        style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono); outline: none;"></textarea>
      {#if addError}
        <p class="text-[9px]" style="color: #8b3a1a; font-family: var(--font-mono);">{addError}</p>
      {/if}
      <button onclick={addCredential} disabled={addBusy}
        class="text-[10px] uppercase tracking-[0.15em] px-4 py-1.5 rounded disabled:opacity-50"
        style="background: var(--accent); color: white; font-family: var(--font-mono);">
        {addBusy ? '…' : 'Save credential'}
      </button>
    </div>
  </section>

  <!-- ── Profiles ── -->
  <section class="mb-10">
    <p class="text-[9px] uppercase tracking-[0.25em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">Browser profiles</p>

    {#if profiles.length === 0}
      <p class="text-sm" style="color: var(--text-muted);">No profiles on disk.</p>
    {:else}
      <div class="rounded-xl border overflow-hidden" style="background: var(--card-bg); border-color: var(--card-border);">
        {#each profiles as name, i}
          <div class="flex items-center justify-between px-4 py-2" style="{i > 0 ? 'border-top: 1px solid var(--divider);' : ''}">
            <span class="text-[11px]" style="color: var(--text-primary); font-family: var(--font-mono);">{name}</span>
            <button onclick={() => clearProfile(name)}
              class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
              style="color: #8b3a1a; border: 1px solid #8b3a1a; font-family: var(--font-mono);">
              Clear profile
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Interactive sessions ── -->
  <section class="mb-10">
    <p class="text-[9px] uppercase tracking-[0.25em] mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">Interactive sessions</p>
    <p class="text-[10px] mb-4" style="color: var(--text-muted); font-family: var(--font-body);">
      Launch a session when a target site needs a human to solve a CAPTCHA / log in. Cookies and localStorage persist in the profile when the session ends, so subsequent headless scrapes ride the same logged-in session.
    </p>

    <!-- Launch form -->
    <div class="rounded-xl border p-4 space-y-3 mb-4" style="background: var(--card-bg); border-color: var(--card-border);">
      <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Launch session</p>
      <div class="flex gap-2">
        <input type="text" placeholder="Profile (e.g. civilservicejobs-gov-uk)" bind:value={sessionProfile}
          class="flex-1 px-2 py-1 rounded text-[11px]"
          style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono); outline: none;" />
        <input type="text" placeholder="Starting URL" bind:value={sessionUrl}
          class="flex-[2] px-2 py-1 rounded text-[11px]"
          style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body); outline: none; min-width: 0;" />
      </div>
      {#if sessionError}
        <p class="text-[9px]" style="color: #8b3a1a; font-family: var(--font-mono);">{sessionError}</p>
      {/if}
      <button onclick={launchSession} disabled={sessionLaunching}
        class="text-[10px] uppercase tracking-[0.15em] px-4 py-1.5 rounded disabled:opacity-50"
        style="background: var(--accent); color: white; font-family: var(--font-mono);">
        {sessionLaunching ? '…' : 'Launch interactive session'}
      </button>
    </div>

    <!-- Active sessions list -->
    {#if sessions.length === 0}
      <p class="text-sm" style="color: var(--text-muted);">No active sessions.</p>
    {:else}
      <div class="rounded-xl border overflow-hidden" style="background: var(--card-bg); border-color: var(--card-border);">
        {#each sessions as s, i}
          <div class="flex items-center gap-3 px-4 py-2 text-[10px]" style="font-family: var(--font-mono); color: var(--text-secondary);{i > 0 ? ' border-top: 1px solid var(--divider);' : ''}">
            <span style="color: var(--text-primary);">{s.profile}</span>
            <span class="flex-1 truncate" style="color: var(--text-ghost);">{s.url}</span>
            <span>{s.startedAt ? new Date(s.startedAt).toLocaleTimeString('en-GB') : '—'}</span>
            <span style="color: #8b3a1a;">exp {s.expiresAt ? new Date(s.expiresAt).toLocaleTimeString('en-GB') : '—'}</span>
            <button onclick={() => { modal = { session: s }; }}
              class="px-2 py-0.5 rounded text-[9px] uppercase tracking-[0.1em]"
              style="border: 1px solid var(--card-border); color: var(--text-secondary);">Open</button>
            <button onclick={() => endSession(s.sessionId)}
              class="px-2 py-0.5 rounded text-[9px] uppercase tracking-[0.1em]"
              style="color: #8b3a1a; border: 1px solid #8b3a1a;">End</button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Recent runs ── -->
  <section class="mb-10">
    <p class="text-[9px] uppercase tracking-[0.25em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">Recent runs</p>

    {#if runs.length === 0}
      <p class="text-sm" style="color: var(--text-muted);">No runs logged yet.</p>
    {:else}
      <div class="rounded-xl border overflow-x-auto" style="background: var(--card-bg); border-color: var(--card-border);">
        <table class="w-full text-[10px]" style="font-family: var(--font-mono); color: var(--text-secondary);">
          <thead>
            <tr style="border-bottom: 1px solid var(--divider);">
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">URL</th>
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">Profile</th>
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">Started</th>
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">Ended</th>
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">OK</th>
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">Pages</th>
              <th class="text-left px-4 py-2 font-normal" style="color: var(--text-ghost);">Error</th>
            </tr>
          </thead>
          <tbody>
            {#each runs as r}
              <tr style="border-bottom: 1px solid var(--divider);">
                <td class="px-4 py-2" style="color: var(--text-ghost);">{trunc(r.url, 60)}</td>
                <td class="px-4 py-2">{r.profile}</td>
                <td class="px-4 py-2">{r.startedAt ? new Date(r.startedAt).toLocaleString('en-GB') : '—'}</td>
                <td class="px-4 py-2">{r.endedAt ? new Date(r.endedAt).toLocaleString('en-GB') : '—'}</td>
                <td class="px-4 py-2" style="color: {r.success ? '#2d7a3a' : '#8b3a1a'};">{r.success ? '✓' : '✗'}</td>
                <td class="px-4 py-2">{r.pagesLoaded}</td>
                <td class="px-4 py-2" style="color: #8b3a1a;">{trunc(r.error, 100)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- ── Ad-hoc test ── -->
  <section>
    <p class="text-[9px] uppercase tracking-[0.25em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">Ad-hoc test</p>
    <div class="rounded-xl border p-4 space-y-3" style="background: var(--card-bg); border-color: var(--card-border);">
      <textarea bind:value={testJobJson} rows="12"
        class="w-full px-2 py-1 rounded text-[10px] resize-y"
        style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono); outline: none; min-height: 200px;"></textarea>
      <p class="text-[9px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Supports all ScrapeJob fields: url, profile, waitFor, extract, pagination, credentialId, pacing.
      </p>
      {#if testError}
        <p class="text-[9px]" style="color: #8b3a1a; font-family: var(--font-mono);">{testError}</p>
      {/if}
      <button onclick={runTest} disabled={testRunning}
        class="text-[10px] uppercase tracking-[0.15em] px-4 py-1.5 rounded disabled:opacity-50"
        style="border: 1px solid var(--card-border); color: var(--text-secondary); font-family: var(--font-mono);">
        {testRunning ? '⏳ Running…' : 'Run test'}
      </button>
      {#if testResult !== null}
        <div class="p-3 rounded text-[10px] overflow-x-auto" style="background: rgba(0,0,0,0.04); border: 1px solid var(--divider); font-family: var(--font-mono); color: var(--text-secondary); white-space: pre-wrap; word-break: break-all;">
          {JSON.stringify(testResult, null, 2)}
        </div>
      {/if}
    </div>
  </section>
</div>

<!-- ── noVNC Modal ── -->
{#if modal}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="dialog"
    aria-modal="true"
    onkeydown={onModalKeydown}
    style="position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; background: rgba(0,0,0,0.65);"
  >
    <!-- Modal panel -->
    <div
      style="margin: auto; width: min(calc(100vw - 2rem), 1200px); display: flex; flex-direction: column; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 0.75rem; overflow: hidden; min-height: 70vh; max-height: calc(100vh - 3rem);"
    >
      <!-- Header bar -->
      <div class="flex items-center gap-3 px-4 py-3" style="border-bottom: 1px solid var(--divider); flex-shrink: 0;">
        <span class="text-[11px] font-medium flex-1" style="color: var(--text-primary); font-family: var(--font-mono);">{modal.session.profile}</span>
        <a
          href={iframeUrl(modal.session)}
          target="_blank"
          rel="noopener noreferrer"
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); color: var(--text-secondary); border: 1px solid var(--card-border);"
        >Open in new tab ↗</a>
        <button
          onclick={() => endSession(modal!.session.sessionId)}
          disabled={modalEnding}
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded disabled:opacity-50"
          style="color: #8b3a1a; border: 1px solid #8b3a1a; font-family: var(--font-mono);"
        >{modalEnding ? '…' : 'End session'}</button>
        <button
          onclick={() => { modal = null; }}
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
          style="color: var(--text-secondary); border: 1px solid var(--card-border); font-family: var(--font-mono);"
        >Close</button>
      </div>
      <!-- iframe -->
      <iframe
        src={iframeUrl(modal.session)}
        title="noVNC — {modal.session.profile}"
        style="flex: 1; width: 100%; border: none; min-height: 0;"
        allow="clipboard-read; clipboard-write"
      ></iframe>
    </div>
  </div>
{/if}
