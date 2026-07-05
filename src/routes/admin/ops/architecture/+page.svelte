<svelte:head><title>Architecture — Admin</title></svelte:head>
<script lang="ts">
  import { onMount } from 'svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import ArchitectureMap from '$lib/components/admin/ArchitectureMap.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let health = $state(data.health);
  let lastAt = $state<number | null>(null);
  let refreshing = $state(false);
  // Plain let — never $state (svelte5-pitfalls rule 1: internal handle).
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const res = await fetch('/api/admin/architecture/health');
      if (res.ok) {
        const body = await res.json();
        health = body.health;
        lastAt = body.at;
      }
    } catch {
      /* transient — keep the last known status */
    } finally {
      refreshing = false;
    }
  }

  function agoLabel(at: number | null): string {
    if (!at) return 'live on load';
    const s = Math.round((Date.now() - at) / 1000);
    return s < 5 ? 'just now' : `${s}s ago`;
  }

  onMount(() => {
    pollTimer = setInterval(refresh, 20000);
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  });
</script>

<PageWrap>
  <PageHeader
    kicker="Ops"
    title="Architecture"
    sub="Live map of the homeserv / Hetzner / Azure / Google estate and how the pieces connect. Probed services show reachability in real time."
  >
    {#snippet actions()}
      <span class="upd">updated {agoLabel(lastAt)}</span>
      <button class="nm-save-btn" onclick={refresh} disabled={refreshing}>
        {refreshing ? 'Probing…' : 'Refresh'}
      </button>
    {/snippet}
  </PageHeader>

  <section class="nm-sec">
    <ArchitectureMap groups={data.groups} nodes={data.nodes} edges={data.edges} {health} />
  </section>
</PageWrap>

<style>
  .upd {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    align-self: center;
  }
</style>
