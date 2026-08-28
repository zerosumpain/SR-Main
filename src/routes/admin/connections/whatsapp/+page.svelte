<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  type Status = {
    source?: string;
    status?: string;
    qr?: string | null;
    connectedNumber?: string | null;
    note?: string;
    error?: string;
  };

  // NB: not named `state` — that shadows the $state rune and the compiler reads
  // the initialiser as referring to itself.
  let wa = $state<Status>({ status: 'loading' });
  let qrSvg = $state('');
  let timer: ReturnType<typeof setInterval> | undefined;

  async function poll(): Promise<void> {
    try {
      const res = await fetch('/api/admin/whatsapp/qr');
      const next = (await res.json()) as Status;
      wa = next;
      qrSvg = next.qr ? await renderQr(next.qr) : '';
    } catch (err) {
      wa = { status: 'error', error: err instanceof Error ? err.message : 'poll failed' };
    }
  }

  async function renderQr(text: string): Promise<string> {
    const QRCode = (await import('qrcode')).default;
    return QRCode.toString(text, { type: 'svg', margin: 1, width: 300 });
  }

  onMount(() => {
    poll();
    // A WhatsApp pairing code rotates roughly every 20 seconds.
    timer = setInterval(poll, 2000);
  });
  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<svelte:head><title>WhatsApp · Connections</title></svelte:head>

<main class="wa">
  <p class="crumb"><a href="/admin/connections">← Connections</a></p>
  <h1>WhatsApp</h1>

  <p class="status">
    <span class="dot" class:ok={wa.status === 'connected'} class:warn={wa.status === 'connecting' || wa.status === 'qr_pending'}></span>
    <strong>{wa.status ?? 'unknown'}</strong>
    {#if wa.connectedNumber}<span class="muted">· {wa.connectedNumber}</span>{/if}
    {#if wa.source}<span class="muted">· via {wa.source}</span>{/if}
  </p>

  {#if wa.error}<p class="err">{wa.error}</p>{/if}
  {#if wa.note}<p class="muted small">{wa.note}</p>{/if}

  {#if qrSvg}
    <div class="qr">{@html qrSvg}</div>
    <p class="how">
      On your phone: <strong>WhatsApp → Settings → Linked devices → Link a device</strong>, then scan this.
      The code rotates every few seconds; this page keeps up.
    </p>
  {:else if wa.status === 'connected'}
    <p class="how">Paired — nothing to scan.</p>
  {:else}
    <p class="how muted">Waiting for a pairing code…</p>
  {/if}
</main>

<style>
  .wa { max-width: 40rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  .crumb { font-size: 0.85rem; margin: 0 0 1rem; }
  h1 { font-size: 1.5rem; margin: 0 0 1rem; }
  .status { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 1rem; }
  .dot { width: 0.6rem; height: 0.6rem; border-radius: 100px; background: #888; flex: none; }
  .dot.ok { background: #2c6f4a; }
  .dot.warn { background: #b8541b; }
  .muted { color: #6b7a7d; font-weight: 400; }
  .small { font-size: 0.9rem; }
  .err { color: #8a2d3a; font-size: 0.95rem; }
  .qr { background: #fff; padding: 1rem; width: max-content; border: 1px solid #dcdcdc; }
  .how { font-size: 0.95rem; line-height: 1.6; margin-top: 1rem; }
</style>
