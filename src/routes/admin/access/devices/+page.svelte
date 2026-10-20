<svelte:head><title>Devices — Admin</title></svelte:head>
<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { PageData, ActionData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import { LANE_LABEL, appLabel, phoneLabel } from '$lib/access/device-rows';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let busy = $state<string | null>(null);

  // Minting the owner's own chat & news code, through the existing endpoint.
  let pairing = $state<{ code: string; qr: string; expiresAt: string } | null>(null);
  let pairError = $state('');
  let minting = $state(false);

  const active = $derived(data.rows.filter((r) => r.status === 'active'));
  const inactive = $derived(data.rows.filter((r) => r.status !== 'active'));

  async function mintOwnCode() {
    minting = true;
    pairError = '';
    try {
      const res = await fetch('/api/admin/native-devices', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        pairError = body.error ?? 'Could not make a code';
        return;
      }
      pairing = { code: body.code, qr: body.qr, expiresAt: body.expiresAt };
    } catch {
      pairError = 'Network error';
    } finally {
      minting = false;
    }
  }

  function when(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function ago(iso: string | null): string {
    if (!iso) return 'never';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 90 * 60) return `${Math.round(s / 60)} min ago`;
    if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  }
</script>

<PageWrap>
  <PageHeader
    kicker="Access"
    title="Devices"
    sub="Every phone paired to the household, whoever paired it. A phone usually holds two pairings: Health & location (the companion app's own server) and Chat & news (this site). Revoking one leaves the other working."
  />

  {#if form?.error}<p class="result-bad" role="alert">{form.error}</p>{/if}

  {#if !data.pilot.ok}
    <p class="nm-sec-error" data-state="pilot-unreachable">
      Health &amp; location: {data.pilot.message} Chat &amp; news pairings are still listed below.
    </p>
  {/if}
  {#if !data.site.ok}
    <p class="nm-sec-error">{data.site.message}</p>
  {/if}

  <section class="nm-sec" data-section="devices">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Paired phones</span>
      <span class="nm-pill" data-state={active.length ? 'connected' : 'disconnected'}>{active.length} active</span>
    </div>

    {#if data.rows.length === 0}
      <p class="muted">No phones are paired yet. People pair from <a href="/welcome">/welcome</a>.</p>
    {:else}
      <div class="table-wrap">
        <table class="devices">
          <colgroup>
            <col style="width: 16%" />
            <col style="width: 14%" />
            <col style="width: 18%" />
            <col style="width: 14%" />
            <col style="width: 10%" />
            <col style="width: 10%" />
            <col style="width: 10%" />
            <col style="width: 8%" />
          </colgroup>
          <thead>
            <tr>
              <th>Person</th>
              <th>Pairing</th>
              <th>Device</th>
              <th>App</th>
              <th>Paired</th>
              <th>Last used</th>
              <th>Expires</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {#each [...active, ...inactive] as row (row.key)}
              <tr class:dim={row.status !== 'active'}>
                <td data-label="Person">
                  <span class="person">{row.person}</span>
                  {#if row.person !== row.email}<span class="email">{row.email}</span>{/if}
                </td>
                <td data-label="Pairing"><span class="chip lane-{row.lane}">{LANE_LABEL[row.lane]}</span></td>
                <td data-label="Device">
                  {phoneLabel(row)}
                  {#if row.os}<span class="email">iOS {row.os}</span>{/if}
                </td>
                <td data-label="App" class="mono">
                  {#if row.app}
                    {appLabel(row)}
                    {#if row.app.since}<span class="email">since {when(row.app.since)}</span>{/if}
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </td>
                <td data-label="Paired" class="mono">{when(row.paired)}</td>
                <td data-label="Last used" class="mono">{ago(row.lastUsed)}</td>
                <td data-label="Expires" class="mono">
                  {row.status === 'revoked' ? 'revoked' : row.status === 'expired' ? 'expired' : when(row.expires)}
                </td>
                <td class="act">
                  {#if row.status === 'active'}
                    <form
                      method="POST"
                      action="?/revoke"
                      use:enhance={({ cancel }) => {
                        if (!confirm(`Revoke ${LANE_LABEL[row.lane]} for ${row.person}? That phone stops syncing it at once.`)) {
                          cancel();
                          return;
                        }
                        busy = row.key;
                        return async ({ update }) => {
                          await update();
                          busy = null;
                        };
                      }}
                    >
                      <input type="hidden" name="lane" value={row.lane} />
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="email" value={row.email} />
                      <button class="row-link danger" disabled={busy === row.key}>
                        {busy === row.key ? 'Revoking…' : 'Revoke'}
                      </button>
                    </form>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section class="nm-sec" data-section="own-pairing">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Pair your phone</span>
    </div>
    <p class="muted">
      One code for everything — chat, news, health and location — good for ten minutes. In the app: Settings →
      Connections → Pair with a code. It only connects a phone signed in as you; anyone else's phone is refused.
    </p>
    {#if pairError}<p class="result-bad" role="alert">{pairError}</p>{/if}
    {#if pairing}
      <div class="pair">
        <img src={pairing.qr} alt="Pairing QR code" width="220" height="220" />
        <div class="pair-meta">
          <span class="sr-label-tight">Or type this code</span>
          <code class="code">{pairing.code}</code>
          <span class="muted">Expires {new Date(pairing.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          <div class="add-row">
            <button class="nm-btn-ghost" onclick={mintOwnCode} disabled={minting}>New code</button>
            <button class="nm-btn-ghost" onclick={() => { pairing = null; invalidateAll(); }}>Done</button>
          </div>
        </div>
      </div>
    {:else}
      <div class="add-row">
        <button class="nm-save-btn" onclick={mintOwnCode} disabled={minting}>
          {minting ? 'Making a code…' : 'Show a pairing code'}
        </button>
      </div>
    {/if}
  </section>
  <section class="nm-sec" data-section="vouch" id="vouch">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Pair a phone for someone</span>
    </div>
    <p class="muted">
      For someone who cannot sign in on the phone — Apple does not let an under-13 account use Sign in with Apple for
      a new app. You vouch instead: this code connects the phone that scans it <strong>as them</strong>, chat, news,
      health and location. Show it only to their phone: in SR, Welcome → Scan the code. Good for ten minutes.
    </p>
    {#if form?.vouchError}<p class="result-bad" role="alert">{form.vouchError}</p>{/if}
    {#if form?.vouch}
      <div class="pair">
        <img src={form.vouch.qr} alt="Pairing QR code for {form.vouch.name}" width="220" height="220" />
        <div class="pair-meta">
          <span class="sr-label-tight">For {form.vouch.name}'s phone only</span>
          <code class="code">{form.vouch.code}</code>
          <span class="muted">
            {form.vouch.email}{form.vouch.admitted ? ' · added to Family Circle' : ''} · expires
            {new Date(form.vouch.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
          {#if form.vouch.household.state === 'linked'}
            <span class="muted" data-household="linked">Linked to {form.vouch.household.name} on the household map.</span>
          {:else if form.vouch.household.state === 'already'}
            <span class="muted" data-household="already">Already {form.vouch.household.name} on the household map.</span>
          {:else if form.vouch.household.state === 'other-email'}
            <span class="result-bad" data-household="other-email">
              {form.vouch.household.name} on the household map has a different address — link them on their access page.
            </span>
          {:else}
            <span class="muted" data-household="unlinked">
              Not on the household map: add them from their access page for location and the family tabs.
            </span>
          {/if}
        </div>
      </div>
    {/if}
    <form method="POST" action="?/vouchPair" use:enhance class="add-row">
      <input class="nm-text-input" name="name" placeholder="Name" maxlength="60" required aria-label="Name" list="vouch-people"
        oninput={(e) => {
          const picked = data.adhoc.household.find((p) => p.name === e.currentTarget.value);
          const email = e.currentTarget.form?.elements.namedItem('email') as HTMLInputElement | null;
          if (picked?.email && email && !email.value) email.value = picked.email;
        }} />
      <datalist id="vouch-people">
        {#each data.adhoc.household as person}<option value={person.name}></option>{/each}
      </datalist>
      <input class="nm-text-input" name="email" type="email" placeholder="Their email (Apple ID)" required aria-label="Email" />
      <button class="nm-save-btn">Show a code</button>
    </form>
  </section>

  <section class="nm-sec" data-section="install" id="install">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Install without TestFlight</span>
      {#if data.adhoc.running}<span class="nm-pill" data-state="connected">building</span>{/if}
    </div>
    <p class="muted">
      For phones that cannot use TestFlight — under 13s can't. Make a link for a person and send it: on their iPhone it
      walks them through a one-time profile that tells the site the phone's ID and starts a copy built for it (about
      half an hour). They install, and come back for updates, at <a href={data.adhoc.appUrl}>{data.adhoc.appUrl}</a>;
      the app also offers each new version itself.
    </p>
    {#if form?.adhocError}<p class="result-bad" role="alert">{form.adhocError}</p>{/if}
    {#if form?.adhocStarted}<p class="muted" role="status">Building a copy for {form.adhocStarted}. About half an hour.</p>{/if}

    {#if !data.adhoc.readable}
      <p class="nm-sec-error">The ad-hoc build on GitHub could not be read.</p>
    {:else if data.adhoc.build}
      <p class="muted">
        Newest copy: {data.adhoc.build.version}, built {when(data.adhoc.build.builtAt)}, installs on
        {data.adhoc.build.devices.join(', ') || 'no phones yet'}.
      </p>
    {:else}
      <p class="muted">No copy has been built yet.</p>
    {/if}

    {#if form?.join}
      <div class="pair">
        <img src={form.join.qr} alt="Join link QR code" width="200" height="200" />
        <div class="pair-meta">
          <span class="sr-label-tight">For {form.join.name} — send it, or scan it with their iPhone</span>
          <code class="code">{form.join.link}</code>
          <span class="muted">Works for {form.join.days} days, on any of their phones.</span>
          <div class="add-row">
            <button class="nm-btn-ghost" onclick={() => navigator.clipboard?.writeText(form?.join?.link ?? '')}>Copy link</button>
          </div>
        </div>
      </div>
    {/if}
    <form method="POST" action="?/joinLink" use:enhance class="add-row">
      <input class="nm-text-input" name="name" placeholder="First name" maxlength="40" required aria-label="First name" list="join-people" />
      <datalist id="join-people">
        {#each data.adhoc.people as person (person)}<option value={person}></option>{/each}
      </datalist>
      <button class="nm-save-btn">Make a link</button>
    </form>

    <details class="manual">
      <summary>Have the UDID already, or just want a fresh copy?</summary>
      <form method="POST" action="?/adhocBuild" use:enhance class="add-row">
        <input class="nm-text-input" name="name" placeholder="Rory's iPhone" maxlength="50" aria-label="Phone name" />
        <input class="nm-text-input mono" name="udid" placeholder="00008110-001A2C3E0E12801E" aria-label="UDID" />
        <button class="nm-btn-ghost">Build a copy</button>
      </form>
      <p class="muted">Leave the UDID empty to rebuild the newest app for the phones already listed.</p>
    </details>
  </section>
</PageWrap>

<style>
  .muted { margin: 0 0 0.75rem; font-size: var(--fs-nav); color: var(--text-secondary); }
  .muted a { color: var(--accent-ink); }
  .result-bad { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--error); margin: 0 0 0.75rem; }
  .table-wrap { overflow-x: auto; }
  .devices {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: var(--fs-nav);
  }
  .devices th {
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    font-weight: 400;
    padding: 0.4rem 0.5rem 0.4rem 0;
    border-bottom: 1px solid var(--line-strong);
  }
  .devices td {
    padding: 0.6rem 0.5rem 0.6rem 0;
    border-bottom: 1px solid var(--divider);
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .devices tr.dim td { color: var(--text-ghost); }
  .person { display: block; color: var(--text-primary); font-weight: 600; }
  .email { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .mono { font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .act { text-align: right; }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 0.1rem 0.4rem;
    border-radius: 2px;
    border: 1px solid var(--divider);
    white-space: nowrap;
  }
  .chip.lane-companion { color: var(--accent-ink); border-color: var(--accent-ink); }
  .chip.lane-site { color: var(--accent); border-color: var(--accent); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .row-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.15rem 0.3rem;
  }
  .row-link.danger:hover { color: var(--error); }
  .row-link:disabled { opacity: 0.5; cursor: default; }
  .add-row { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.4rem; flex-wrap: wrap; }
  .pair { display: flex; gap: 1.25rem; align-items: flex-start; flex-wrap: wrap; }
  .pair img { border: 1px solid var(--line-strong); image-rendering: pixelated; }
  .pair-meta { display: flex; flex-direction: column; gap: 0.4rem; min-width: 0; }
  .manual summary { cursor: pointer; font-size: var(--fs-nav); color: var(--text-secondary); margin: 0.5rem 0; }
  .code {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    background: var(--bg-section);
    padding: 0.3rem 0.5rem;
    border-radius: 2px;
    overflow-wrap: anywhere;
  }

  /* Phone: each row becomes a card of labelled lines. */
  @media (max-width: 640px) {
    .devices, .devices tbody, .devices tr, .devices td { display: block; width: 100%; }
    .devices colgroup, .devices thead { display: none; }
    .devices tr { border-bottom: 1px solid var(--divider); padding: 0.5rem 0; }
    .devices td { border: none; padding: 0.15rem 0; }
    .devices td[data-label]:not([data-label='Person'])::before {
      content: attr(data-label);
      display: inline-block;
      min-width: 6.5rem;
      font-family: var(--font-mono);
      font-size: var(--fs-label-xs);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-ghost);
    }
    .act { text-align: left; }
  }
</style>
