<svelte:head><title>Paired devices — Admin</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  type Device = {
    id: string;
    label: string | null;
    createdAt: string | Date;
    expiresAt: string | Date;
    revokedAt: string | Date | null;
    lastUsedAt: string | Date | null;
    useCount: number;
  };

  let { data }: { data: PageData } = $props();

  let devices = $state<Device[]>(data.devices as Device[]);
  let pairing = $state(false);
  let errorMsg = $state('');
  let busyId = $state<string | null>(null);

  /**
   * The live pairing code, and the only moment it exists in plaintext here.
   *
   * Held in component state and never written anywhere else — no URL, no
   * localStorage, no log. It is cleared when the countdown runs out so a screen
   * left open does not keep showing something the server has already expired.
   */
  let code = $state<{ payload: string; code: string; expiresAt: number } | null>(null);
  let qrSvg = $state('');
  let showCode = $state(false);

  /**
   * The countdown runs off a ticking clock, not off the code.
   *
   * The obvious shape — an effect that reads `code`, computes the remaining
   * seconds and nulls `code` at zero — is an effect reading what it just wrote,
   * which is the documented loop in this codebase. Ticking `now` instead means
   * the effect writes one primitive nothing else owns, and both the countdown
   * and the expiry fall out as `$derived`. The interval handle is a plain `let`
   * for the same reason: a `$state` handle read and written by the same function
   * re-triggers the effect that owns it.
   */
  let now = $state(Date.now());

  $effect(() => {
    if (!code) return;
    const tick = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(tick);
  });

  const secondsLeft = $derived(
    code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0,
  );
  // Expired codes SAY so rather than vanishing. A panel that silently empties
  // looks like a bug the moment you glance away for ten minutes.
  const expired = $derived(!!code && secondsLeft === 0);

  async function createCode() {
    errorMsg = '';
    pairing = true;
    try {
      const res = await fetch('/api/admin/native-devices', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        errorMsg = body.error ?? 'Could not create a pairing code';
        return;
      }
      // Rendered in the browser with the pinned `qrcode` package, so the code
      // never reaches an external QR service.
      const QR = (await import('qrcode')).default;
      qrSvg = await QR.toString(body.payload, {
        type: 'svg',
        margin: 1,
        width: 220,
        color: { dark: '#1a1008', light: '#ede4d4' },
      });
      showCode = false;
      now = Date.now();
      code = {
        payload: body.payload,
        code: body.code,
        expiresAt: new Date(body.expiresAt).getTime(),
      };
    } catch {
      errorMsg = 'Network error';
    } finally {
      pairing = false;
    }
  }

  async function revoke(device: Device) {
    if (!confirm(`Revoke ${device.label ?? 'this iPhone'}? It stops reading chat and news at once.`))
      return;
    busyId = device.id;
    errorMsg = '';
    try {
      const res = await fetch(`/api/admin/native-devices?id=${encodeURIComponent(device.id)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        devices = devices.map((d) =>
          d.id === device.id ? { ...d, revokedAt: new Date().toISOString() } : d,
        );
      } else {
        errorMsg = body.error ?? 'Could not revoke that device';
      }
    } catch {
      errorMsg = 'Network error';
    } finally {
      busyId = null;
    }
  }

  function formatDate(value: string | Date | null): string {
    if (!value) return 'never';
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function statusOf(device: Device): { label: string; state: string } {
    if (device.revokedAt) return { label: 'Revoked', state: 'disconnected' };
    if (new Date(device.expiresAt).getTime() < Date.now())
      return { label: 'Expired', state: 'disconnected' };
    return { label: 'Active', state: 'connected' };
  }

  const active = $derived(devices.filter((d) => statusOf(d).label === 'Active').length);
</script>

<PageWrap>
  <PageHeader
    kicker="Access"
    title="Paired devices"
    sub="iPhones signed in to the companion app. A paired phone reads chat and the news desk as you; it never gets more than this browser session has."
    crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Access', href: '/admin/access' }, { label: 'Devices' }]}
  />

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Pair an iPhone</span>
      <span class="nm-pill" data-state={active ? 'connected' : 'disconnected'}>
        {active} active
      </span>
    </div>
    <p class="muted">
      Open the app, choose <strong>Pair by QR code</strong>, and scan this screen. The code works
      once and expires after ten minutes. Creating a new one invalidates the last.
    </p>

    {#if code}
      <div class="pair-panel" class:spent={expired}>
        <div class="qr" aria-hidden={expired}>{@html qrSvg}</div>
        <div class="pair-detail">
          {#if expired}
            <span class="sr-label-tight">Expired</span>
            <p class="countdown spent-note">This code no longer works. Create another.</p>
          {:else}
            <span class="sr-label-tight">Expires in</span>
            <p class="countdown" class:urgent={secondsLeft < 60}>
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            </p>
            <button class="row-link" onclick={() => (showCode = !showCode)}>
              {showCode ? 'Hide' : 'Show'} the code for manual entry
            </button>
            {#if showCode}
              <code class="raw-code">{code.code}</code>
            {/if}
          {/if}
        </div>
      </div>
    {/if}

    <div class="add-row">
      <button class="nm-save-btn" onclick={createCode} disabled={pairing}>
        {pairing ? 'Creating…' : code ? 'Create a new code' : 'Create pairing QR code'}
      </button>
      {#if errorMsg}<span class="result-bad">{errorMsg}</span>{/if}
    </div>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Devices</span>
      <span class="nm-pill" data-state={devices.length ? 'connected' : 'disconnected'}>
        {devices.length} total
      </span>
    </div>
    <ul class="device-list">
      {#each devices as device (device.id)}
        {@const status = statusOf(device)}
        <li class="device-row">
          <span class="label">{device.label ?? 'iPhone'}</span>
          <span class="nm-pill" data-state={status.state}>{status.label}</span>
          <span class="meta">paired {formatDate(device.createdAt)}</span>
          <span class="meta">last seen {formatDate(device.lastUsedAt)}</span>
          <span class="meta">{device.useCount} requests</span>
          {#if !device.revokedAt}
            <button
              class="row-link danger"
              onclick={() => revoke(device)}
              disabled={busyId === device.id}
            >
              {busyId === device.id ? 'Revoking…' : 'Revoke'}
            </button>
          {/if}
        </li>
      {:else}
        <li class="device-row muted">No iPhone has been paired yet.</li>
      {/each}
    </ul>
  </section>
</PageWrap>

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    margin: 0 0 16px;
  }

  .pair-panel {
    display: flex;
    gap: 24px;
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 20px;
    margin-bottom: 18px;
    /* Opaque, not --card-bg: that is a 7% tint and the QR needs a solid quiet
       zone behind it or a scanner reads the page through it. */
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
  }
  .qr {
    line-height: 0;
  }
  /* A spent code stays on screen, greyed, so it reads as expired rather than
     as a panel that emptied itself. */
  .pair-panel.spent .qr {
    opacity: 0.25;
  }
  .spent-note {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
    max-width: 30ch;
  }
  .pair-detail {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .countdown {
    font-family: var(--font-mono);
    font-size: 28px;
    margin: 0;
  }
  .countdown.urgent {
    color: var(--accent);
  }
  .raw-code {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    /* A 43-character base64url secret has no spaces to break at, and an
       unbreakable token scrolls the whole panel sideways. */
    word-break: break-all;
    max-width: 34ch;
    padding: 8px 10px;
    background: var(--code-bg);
    color: var(--code-text);
  }

  .add-row {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .result-bad {
    color: var(--error);
    font-size: var(--fs-body-sm);
  }

  .device-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .device-row {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    padding: 12px 0;
    border-bottom: 1px solid var(--divider);
  }
  .device-row:last-child {
    border-bottom: none;
  }
  .label {
    font-weight: 600;
  }
  .meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
</style>
