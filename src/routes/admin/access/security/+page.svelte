<svelte:head><title>Security — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import type { PageData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  type Sshd = {
    passwordAuthentication: boolean | null;
    pubkeyAuthentication: boolean | null;
    permitRootLogin: string | null;
    port: string | null;
    maxAuthTries: string | null;
  };
  type Fail2ban = {
    installed: boolean;
    jail: string;
    currentlyBanned: number;
    totalBanned: number;
    bannedIps: string[];
    ignoreIps: string[];
  };
  type Exposure = { failedAttempts: number; distinctSourceIps: number; windowHours: number };
  type Host = {
    host: string;
    reachable: boolean;
    error?: string;
    sshd: Sshd | null;
    fail2ban: Fail2ban | null;
    exposure: Exposure | null;
    authBypass: boolean;
  };

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');

  // Only the ban lists mutate (unban), so only they are $state. Everything else
  // renders straight from `data` — no prop→state sync effect, nothing to loop.
  let hosts = $state<Host[]>([data.local as Host, data.peer as Host].filter(Boolean) as Host[]);
  let busyIp = $state<string | null>(null);
  let errorMsg = $state('');

  function apiUrl(): string {
    return adminToken ? `/api/admin/security?token=${adminToken}` : '/api/admin/security';
  }

  /** Only the host actually serving this page can lift its own bans. */
  const localHost = data.local as Host;

  async function unban(ip: string) {
    errorMsg = '';
    busyIp = ip;
    try {
      const res = await fetch(apiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unban', ip }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        hosts = hosts.map((h) =>
          h.host === localHost.host && h.fail2ban
            ? {
                ...h,
                fail2ban: {
                  ...h.fail2ban,
                  bannedIps: h.fail2ban.bannedIps.filter((b) => b !== ip),
                  currentlyBanned: Math.max(0, h.fail2ban.currentlyBanned - 1),
                },
              }
            : h,
        );
      } else {
        errorMsg = body.error ?? `Could not unban ${ip}`;
      }
    } catch {
      errorMsg = 'Network error';
    } finally {
      busyIp = null;
    }
  }

  /** "unknown" is a distinct state from "off" and must never render as safe. */
  function verdict(v: boolean | null, safeWhen: boolean): 'ok' | 'warn' | 'unknown' {
    if (v === null) return 'unknown';
    return v === safeWhen ? 'ok' : 'warn';
  }

  /**
   * Exposure is the number that decides whether password auth matters at all:
   * an internet-reachable port 22 is brute-forced constantly, a private one is
   * silent. Without this the panel would repeat a generic warning as if it were
   * a finding about this host.
   */
  function exposureLabel(e: Exposure | null): { text: string; tone: 'ok' | 'warn' | 'unknown' } {
    if (!e) return { text: 'unknown', tone: 'unknown' };
    if (e.failedAttempts === 0)
      return { text: `no attempts in ${e.windowHours}h — not internet-reachable`, tone: 'ok' };
    return {
      text: `${e.failedAttempts.toLocaleString()} failed from ${e.distinctSourceIps} IPs in ${e.windowHours}h`,
      tone: 'warn',
    };
  }
</script>

<PageWrap>
  <PageHeader
    kicker="Access"
    title="Security posture"
    sub="What is blocked and what is allowed, read live from each host. Configuration is deliberately read-only here — the only action is lifting a fail2ban ban."
  />

  {#if errorMsg}
    <p class="err">{errorMsg}</p>
  {/if}

  {#each hosts as h (h.host)}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Host — {h.host}</span>
        {#if h.authBypass}
          <span class="pill warn">AUTH_BYPASS ON</span>
        {/if}
      </div>

      {#if !h.reachable}
        <p class="muted">Unreachable: {h.error ?? 'no response'}</p>
      {:else}
        <div class="grid">
          <div class="tile">
            <span class="k">Password auth</span>
            {#if h.sshd}
              <span class="v {verdict(h.sshd.passwordAuthentication, false)}">
                {h.sshd.passwordAuthentication === null
                  ? 'unknown'
                  : h.sshd.passwordAuthentication ? 'enabled' : 'disabled'}
              </span>
            {:else}
              <span class="v unknown">unreadable</span>
            {/if}
          </div>

          <div class="tile">
            <span class="k">Root login</span>
            <span class="v {h.sshd?.permitRootLogin === 'no' ? 'ok' : 'warn'}">
              {h.sshd?.permitRootLogin ?? 'unknown'}
            </span>
          </div>

          <div class="tile">
            <span class="k">Exposure</span>
            <span class="v {exposureLabel(h.exposure).tone}">{exposureLabel(h.exposure).text}</span>
          </div>

          <div class="tile">
            <span class="k">fail2ban</span>
            <span class="v {h.fail2ban ? 'ok' : 'warn'}">
              {h.fail2ban
                ? `${h.fail2ban.currentlyBanned} banned now · ${h.fail2ban.totalBanned} total`
                : 'not installed'}
            </span>
          </div>
        </div>

        {#if h.authBypass}
          <p class="muted">
            AUTH_BYPASS grants admin to any client on a private address. On a host behind
            cloudflared every request looks local — that combination caused the 2026-07-24
            public /admin exposure.
          </p>
        {/if}

        {#if h.fail2ban}
          <div class="sub-hd"><span class="sr-label-tight">Blocked — jail {h.fail2ban.jail}</span></div>
          {#if h.fail2ban.bannedIps.length === 0}
            <p class="muted">Nothing currently banned.</p>
          {:else}
            <ul class="ips">
              {#each h.fail2ban.bannedIps as ip (ip)}
                <li>
                  <code>{ip}</code>
                  {#if h.host === localHost.host}
                    <button
                      class="nm-btn-ghost"
                      disabled={busyIp === ip}
                      onclick={() => unban(ip)}
                    >{busyIp === ip ? 'lifting…' : 'unban'}</button>
                  {:else}
                    <span class="muted-inline">managed on {h.host}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}

          {#if h.fail2ban.ignoreIps.length}
            <div class="sub-hd"><span class="sr-label-tight">Never banned</span></div>
            <p class="muted">
              {#each h.fail2ban.ignoreIps as net, i (net)}<code>{net}</code>{#if i < h.fail2ban.ignoreIps.length - 1}<span> · </span>{/if}{/each}
            </p>
          {/if}
        {/if}
      {/if}
    </section>
  {/each}

  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Allowed — sign-in</span></div>
    <p class="muted">Owners have full access. Guests are recognised but see only public pages.</p>
    <ul class="ips">
      {#each data.access.owners as email (email)}
        <li><code>{email}</code><span class="pill">owner</span></li>
      {/each}
      {#each data.access.guests as g (g.email)}
        <li><code>{g.email}</code><span class="muted-inline">{g.note ?? 'guest'}</span></li>
      {/each}
    </ul>
    <p class="muted"><a class="link" href="/admin/access">Manage the allow-list →</a></p>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Allowed — no authentication</span></div>
    <p class="muted">
      API routes reachable by anyone. This is the exact list the auth gate enforces, not a copy
      of it — adding a route here makes it world-readable.
    </p>
    <ul class="ips">
      {#each data.access.publicApiPaths as p (p)}
        <li><code>{p}</code></li>
      {/each}
    </ul>
  </section>
</PageWrap>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--border-subtle, rgba(26, 16, 8, 0.14));
    border-radius: 2px;
  }
  .k {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .v { font-size: 0.9rem; color: var(--text-primary); }
  .v.ok { color: var(--success); }
  .v.warn { color: var(--error); }
  .v.unknown { color: var(--warn); }
  .sub-hd { margin: 1rem 0 0.5rem; }
  .ips { list-style: none; margin: 0; padding: 0; }
  .ips li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--border-subtle, rgba(26, 16, 8, 0.1));
  }
  .ips code, .muted code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    color: var(--text-primary);
  }
  .pill {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 0.12rem 0.4rem;
    border: 1px solid var(--border-subtle, rgba(26, 16, 8, 0.2));
    border-radius: 2px;
    color: var(--text-secondary);
  }
  .pill.warn { color: var(--error); border-color: var(--error); }
  .muted { margin: 0 0 0.75rem; font-size: 0.85rem; color: var(--text-secondary); }
  .muted-inline { font-size: 0.8rem; color: var(--text-muted); }
  .err { margin: 0 0 1rem; font-size: 0.85rem; color: var(--error); }
  .link { color: var(--accent); text-decoration: none; }
  .link:hover { text-decoration: underline; }
</style>
