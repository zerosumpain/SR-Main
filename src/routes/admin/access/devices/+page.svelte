<svelte:head><title>Devices — Admin</title></svelte:head>
<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { PageData, ActionData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import { LANE_LABEL } from './rows';

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
            <col style="width: 18%" />
            <col style="width: 16%" />
            <col style="width: 18%" />
            <col style="width: 12%" />
            <col style="width: 12%" />
            <col style="width: 12%" />
            <col style="width: 12%" />
          </colgroup>
          <thead>
            <tr>
              <th>Person</th>
              <th>Pairing</th>
              <th>Device</th>
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
                <td data-label="Device">{row.label ?? 'iPhone'}</td>
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
      <span class="sr-label-tight">Pair your phone · chat &amp; news</span>
    </div>
    <p class="muted">
      A one-time code for the SR app's chat and news tabs, good for ten minutes. In the app: Settings → Pair with
      the site, then scan. Health &amp; location pairing is on <a href="/welcome">/welcome</a>.
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
