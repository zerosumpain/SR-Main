<script lang="ts">
  import { onMount } from 'svelte';
  import { canRequestPush, subscribeToPush } from '$lib/jkai/pwa/push-client';

  let { vapidPublicKey }: { vapidPublicKey: string } = $props();
  let visible = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const DISMISS_KEY = 'jkai.pushOptInDismissed';

  onMount(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;
    if (canRequestPush()) visible = true;
  });

  async function enable() {
    busy = true;
    error = null;
    try {
      await subscribeToPush({ vapidPublicKey });
      visible = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    visible = false;
  }
</script>

{#if visible}
  <aside class="nm-sec push-opt-in">
    <h3>Push notifications</h3>
    <p>Get a ping when builds finish or a job needs approval.</p>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="row">
      <button class="nm-save-btn" disabled={busy} onclick={enable} type="button">
        {busy ? 'Enabling…' : 'Enable'}
      </button>
      <button type="button" onclick={dismiss}>Not now</button>
    </div>
  </aside>
{/if}

<style>
  .push-opt-in { padding: 0.75rem; margin: 0.5rem; }
  .row { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .error { color: #b00; font: 0.75rem 'JetBrains Mono', monospace; }
</style>
