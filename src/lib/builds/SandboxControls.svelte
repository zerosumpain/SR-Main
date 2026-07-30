<script lang="ts">
  import { onMount } from 'svelte';

  let {
    buildId,
    status,
  }: {
    buildId: string;
    status: string;
  } = $props();

  let snapshots = $state<number[]>([]);
  let busy = $state<string | null>(null);
  let lastError = $state<string | null>(null);

  async function loadSnaps() {
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}/sandbox`);
      if (r.ok) snapshots = (await r.json()).snapshots ?? [];
    } catch {
      // ignore — will retry next click
    }
  }

  async function call(action: string, extra: Record<string, unknown>, label: string) {
    if (status === 'running') {
      lastError = 'Pause the build first.';
      return;
    }
    if (action === 'reset' && !confirm('Wipe the dev workspace? Snapshot first if you want to recover.')) return;
    busy = label;
    lastError = null;
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}/sandbox`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!r.ok) {
        lastError = `${label}: ${(await r.text()).slice(0, 200)}`;
      } else if (action === 'snapshot') {
        await loadSnaps();
      }
    } finally {
      busy = null;
    }
  }

  onMount(loadSnaps);
</script>

<section class="nm-sec">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Sandbox</span>
  </header>
  <div class="row">
    <button
      class="nm-btn-ghost"
      disabled={busy !== null || status === 'running'}
      onclick={() => call('snapshot', {}, 'Snapshot')}
      type="button"
    >
      {busy === 'Snapshot' ? '…' : 'Snapshot now'}
    </button>
    <button
      class="row-link danger"
      disabled={busy !== null || status === 'running'}
      onclick={() => call('reset', {}, 'Reset')}
      type="button"
    >
      Reset workspace
    </button>
  </div>
  {#if snapshots.length > 0}
    <p class="lbl">Restore from snapshot</p>
    <ul>
      {#each snapshots as n (n)}
        <li>
          <button
            class="row-link"
            disabled={busy !== null || status === 'running'}
            onclick={() => call('restore', { iterationNumber: n }, `Restore ${n}`)}
            type="button"
          >
            ↩ iter {n}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if status === 'running'}
    <p class="dim">Pause the build to use sandbox actions.</p>
  {/if}
  {#if lastError}<p class="err">{lastError}</p>{/if}
</section>

<style>
  .row {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .lbl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin: 8px 0 4px;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    margin: 6px 0 0;
  }
  .err {
    color: var(--status-error);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    margin: 6px 0 0;
  }
</style>
