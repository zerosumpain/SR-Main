<svelte:head><title>WhatsApp bridge — Admin</title></svelte:head>
<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance, deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { WhatsAppBridgeStatus, PairState } from '$lib/server/hermes-whatsapp';

  let {
    data,
  }: {
    data: {
      status: WhatsAppBridgeStatus | null;
      loadError: string | null;
      pair: PairState | null;
      canManage: boolean;
      direct: boolean;
      hostname: string;
    };
  } = $props();

  // Live pairing state. Seeded from the load, then replaced by the poller —
  // the QR rotates every ~20s, so the server-rendered one is stale on arrival.
  let pair = $state<PairState | null>(data.pair);
  let pending = $state<string | null>(null);
  let notice = $state<{ ok: boolean; text: string } | null>(null);
  let rechecking = $state(false);

  // Plain `let`, never $state: the poller reads and writes this handle inside
  // start/stop, and a $state handle would make the $effect below subscribe to
  // its own write and loop.
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const IN_FLIGHT: PairState['phase'][] = ['starting', 'awaiting_scan', 'linking', 'installing'];
  const pairing = $derived(!!pair && IN_FLIGHT.includes(pair.phase));

  async function pollOnce(): Promise<void> {
    try {
      const res = await fetch('?/pollPair', {
        method: 'POST',
        headers: { 'x-sveltekit-action': 'true' },
        body: new FormData(),
      });
      const result = deserialize(await res.text());
      if (result.type === 'success') {
        const next = (result.data as { pair?: PairState } | undefined)?.pair;
        if (next) pair = next;
      }
    } catch {
      // A dropped poll is not a failure — the next tick picks it up. This is
      // exactly what happens while Hermes is restarting mid-install.
    }
  }

  // Also a plain `let`: the effect's own teardown nulls pollTimer before the
  // body re-runs, so pollTimer cannot be used to detect "a run just ended" —
  // it is always null by then, and the refresh below would never fire.
  let wasPairing = false;

  $effect(() => {
    const active = pairing;
    untrack(() => {
      if (active) {
        wasPairing = true;
        if (!pollTimer) pollTimer = setInterval(pollOnce, 2000);
      } else {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (wasPairing) {
          wasPairing = false;
          // The run just ended — re-read the real status so the panel above
          // agrees with what pairing did, rather than showing the pre-run state.
          void invalidateAll();
        }
      }
    });
    return () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  });

  function run(name: string): SubmitFunction {
    return () => {
      pending = name;
      notice = null;
      return async ({ result }) => {
        pending = null;
        const payload = (result.type === 'success' || result.type === 'failure'
          ? (result.data ?? {})
          : {}) as { pair?: PairState; message?: string; error?: string };
        if (payload.pair) pair = payload.pair;
        if (result.type === 'success') {
          if (payload.message) notice = { ok: true, text: payload.message };
          if (!payload.pair) await invalidateAll();
        } else if (result.type === 'failure') {
          notice = { ok: false, text: payload.error ?? 'that did not work' };
        } else {
          notice = { ok: false, text: 'the action did not complete' };
        }
      };
    };
  }

  async function recheck(): Promise<void> {
    if (rechecking) return;
    rechecking = true;
    try {
      await invalidateAll();
    } finally {
      rechecking = false;
    }
  }

  const tone = $derived(
    !data.status ? 'off' : data.status.remedy === 'none' ? 'ok' : 'bad',
  );

  function fmtUptime(sec: number | null): string {
    if (sec == null) return '—';
    if (sec < 90) return `${Math.round(sec)}s`;
    if (sec < 5400) return `${Math.round(sec / 60)}m`;
    return `${(sec / 3600).toFixed(1)}h`;
  }

  function fmtWhen(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }
</script>

<PageWrap>
  <PageHeader
    kicker="Admin · Connections"
    title="WHATSAPP BRIDGE"
    sub="The Baileys link between WhatsApp and jkai. Probed live — status, re-pairing and repair, without a terminal."
  />

  {#if !data.canManage}
    <p class="wa-warn">
      WhatsApp control is unavailable from <code>{data.hostname}</code> — no homeserv route is
      configured. Set <code>HERMES_ADMIN_SERVICE_URL</code> and <code>HERMES_BRIDGE_SECRET</code>,
      or open this page on homeserv.
    </p>
  {:else if data.loadError}
    <p class="wa-warn">Could not read the bridge state: {data.loadError}</p>
  {/if}

  {#if data.status}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Status</span>
        <span class="nm-sec-meta">
          {data.direct ? 'read directly on homeserv' : `proxied to homeserv from ${data.hostname}`}
        </span>
      </div>

      <div class="wa-head">
        <span class="dot {tone}" aria-hidden="true"></span>
        <p class="wa-diag">{data.status.diagnosis}</p>
        <button class="nm-save-btn ghost" onclick={recheck} disabled={rechecking}>
          {rechecking ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      <div class="wa-grid">
        <div class="wa-cell">
          <span class="wa-l">Session</span>
          <span class="wa-v">{data.status.paired ? 'paired' : 'not paired'}</span>
        </div>
        <div class="wa-cell">
          <span class="wa-l">Number</span>
          <span class="wa-v">{data.status.pairedNumber ?? '—'}</span>
        </div>
        <div class="wa-cell">
          <span class="wa-l">Bridge</span>
          <span class="wa-v">{data.status.bridgeReachable ? (data.status.bridgeState ?? 'up') : 'unreachable'}</span>
        </div>
        <div class="wa-cell">
          <span class="wa-l">Uptime</span>
          <span class="wa-v">{fmtUptime(data.status.bridgeUptimeSec)}</span>
        </div>
        <div class="wa-cell">
          <span class="wa-l">Gateway</span>
          <span class="wa-v">{data.status.gateway}</span>
        </div>
        <div class="wa-cell">
          <span class="wa-l">Queue</span>
          <span class="wa-v">{data.status.bridgeQueueLength ?? '—'}</span>
        </div>
      </div>

      <p class="wa-note">
        Session at <code>{data.status.sessionDir}</code>{#if data.status.legacyLayout} (legacy layout){/if}
        {#if data.status.pairedAt} · linked {fmtWhen(data.status.pairedAt)}{/if}
      </p>

      {#if notice}
        <p class="wa-result" class:bad={!notice.ok}>{notice.ok ? '✓' : '✗'} {notice.text}</p>
      {/if}
    </section>

    <!-- Pairing. Shown whenever a run is live, and offered as the primary
         action whenever the session is what's missing. -->
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Reconnect</span>
        <span class="nm-sec-meta">links this server as a device on your WhatsApp account</span>
      </div>

      {#if pairing && pair}
        <div class="wa-pair">
          {#if pair.qrSvg}
            <div class="wa-qr">
              <!-- Server-rendered SVG from the `qrcode` package. -->
              {@html pair.qrSvg}
            </div>
            <div class="wa-steps">
              <p class="wa-step-h">On your phone</p>
              <ol class="wa-ol">
                <li>WhatsApp → <strong>Settings</strong></li>
                <li><strong>Linked devices</strong> → <strong>Link a device</strong></li>
                <li>Scan the code on the left</li>
              </ol>
              <p class="wa-sub">
                Code {pair.qrCount} · WhatsApp rotates it every ~20 seconds, so this refreshes
                on its own. Don't screenshot it — just scan whatever is showing.
              </p>
            </div>
          {:else}
            <div class="wa-working">
              <span class="wa-spin" aria-hidden="true"></span>
              <p class="wa-diag">{pair.message}</p>
            </div>
          {/if}
        </div>

        <div class="btn-row">
          <form method="POST" action="?/cancelPair" use:enhance={run('cancel')}>
            <button class="nm-save-btn ghost" disabled={pending !== null}>
              {pending === 'cancel' ? 'Stopping…' : 'Cancel'}
            </button>
          </form>
        </div>
      {:else}
        {#if pair && pair.phase === 'connected'}
          <p class="wa-result">✓ {pair.message}</p>
        {:else if pair && (pair.phase === 'error' || pair.phase === 'cancelled')}
          <p class="wa-result bad">✗ {pair.message}</p>
        {/if}

        <p class="wa-note">
          Use this when the session has been logged out or lost. It pairs into a staging
          directory first and only replaces the live session once WhatsApp confirms the link,
          then restarts Hermes and waits for the bridge to answer.
        </p>

        <div class="btn-row">
          <form method="POST" action="?/startPair" use:enhance={run('pair')}>
            <button
              class="nm-save-btn"
              class:primary={data.status.remedy === 'pair'}
              disabled={!data.canManage || pending !== null}
            >
              {pending === 'pair' ? 'Starting…' : 'Pair with WhatsApp'}
            </button>
          </form>

          <form method="POST" action="?/repair" use:enhance={run('restart')}>
            <input type="hidden" name="action" value="restart_bridge" />
            <button
              class="nm-save-btn"
              class:primary={data.status.remedy === 'restart' || data.status.remedy === 'start_gateway'}
              disabled={!data.canManage || pending !== null}
            >
              {pending === 'restart' ? 'Restarting…' : 'Restart the bridge'}
            </button>
          </form>
        </div>
        <p class="wa-sub">
          A restart only helps when the session is still paired — it cannot bring back a session
          WhatsApp has logged out.
        </p>
      {/if}
    </section>

    {#if data.status.logTail.length}
      <section class="nm-sec">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">Bridge log</span>
          <span class="nm-sec-meta">last {data.status.logTail.length} lines</span>
        </div>
        <pre class="wa-log">{data.status.logTail.join('\n')}</pre>
      </section>
    {/if}

    {#if pair && pair.log.length}
      <section class="nm-sec">
        <div class="nm-sec-hd"><span class="sr-label-tight">Pairing log</span></div>
        <pre class="wa-log">{pair.log.join('\n')}</pre>
      </section>
    {/if}

    {#if data.status.paired}
      <section class="nm-sec">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">Unlink</span>
          <span class="nm-sec-meta">archives the session, does not delete it</span>
        </div>
        <p class="wa-note">
          Moves the current credentials aside and restarts Hermes, leaving WhatsApp disconnected
          until you pair again. Only worth doing when the session is paired but permanently
          refusing to connect.
        </p>
        <div class="btn-row">
          <form
            method="POST"
            action="?/repair"
            use:enhance={run('reset')}
            onsubmit={(e) => {
              if (!confirm('Unlink the WhatsApp session? You will have to scan a QR to reconnect.')) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="action" value="reset_session" />
            <button class="nm-save-btn danger" disabled={!data.canManage || pending !== null}>
              {pending === 'reset' ? 'Unlinking…' : 'Unlink session'}
            </button>
          </form>
        </div>
      </section>
    {/if}
  {/if}
</PageWrap>

<style>
  .wa-warn {
    margin: 0 0 1.5rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--danger, #c0392b);
    border-radius: var(--radius-round);
    background: var(--bg-section);
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  code {
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
    border-radius: 2px;
  }

  .wa-head { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
  .wa-diag { margin: 0; flex: 1 1 20ch; font-size: 1rem; line-height: 1.5; color: var(--text-primary); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; background: var(--text-muted); }
  .dot.ok { background: var(--success, #2d7a3a); }
  .dot.bad { background: var(--danger, #c0392b); }
  .dot.off { background: var(--text-muted); }

  .wa-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 0.6rem; margin: 1rem 0 0; }
  .wa-cell { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.6rem 0.7rem; border: 1px solid var(--card-border); border-radius: var(--radius-round); background: var(--bg-section); min-width: 0; }
  .wa-l { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .wa-v { font-family: var(--font-mono); font-size: 1rem; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; }

  .wa-note { font-size: 0.85rem; color: var(--text-secondary); margin: 0.8rem 0 0; line-height: 1.5; max-width: 72ch; word-break: break-word; }
  .wa-sub { font-size: 0.8rem; color: var(--text-muted); margin: 0.6rem 0 0; line-height: 1.5; max-width: 72ch; }
  .wa-result { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--success, #2d7a3a); margin: 0.8rem 0 0; }
  .wa-result.bad { color: var(--danger, #c0392b); }

  .wa-pair { display: flex; gap: 1.4rem; flex-wrap: wrap; align-items: flex-start; margin-top: 0.4rem; }
  /* White plate regardless of theme: WhatsApp's scanner needs the light quiet
     zone, and a dark-mode inversion is the classic "the QR won't scan" bug. */
  .wa-qr { background: #fff; padding: 12px; border-radius: var(--radius-round); border: 1px solid var(--card-border); line-height: 0; flex: 0 0 auto; }
  .wa-qr :global(svg) { display: block; width: 260px; height: 260px; }
  .wa-steps { flex: 1 1 24ch; min-width: 0; }
  .wa-step-h { margin: 0 0 0.4rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .wa-ol { margin: 0; padding-left: 1.2rem; font-size: 0.9rem; line-height: 1.7; color: var(--text-secondary); list-style: decimal; }

  .wa-working { display: flex; align-items: center; gap: 0.7rem; padding: 1rem 0; }
  .wa-spin { width: 14px; height: 14px; border: 2px solid var(--card-border); border-top-color: var(--accent); border-radius: 50%; animation: wa-spin 0.8s linear infinite; flex-shrink: 0; }
  @keyframes wa-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .wa-spin { animation: none; } }

  .btn-row { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-top: 1rem; align-items: center; }
  .nm-save-btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .nm-save-btn.danger { color: var(--danger, #c0392b); border-color: var(--danger, #c0392b); }

  .wa-log { margin: 0.6rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-secondary); background: var(--bg-section); border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 0.7rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 20rem; overflow-y: auto; }
</style>
