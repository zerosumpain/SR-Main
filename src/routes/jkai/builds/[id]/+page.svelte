<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import BuildDetailV2 from '$lib/builds/BuildDetailV2.svelte';
  import BuildSession from '$lib/builds/BuildSession.svelte';
  import { openJkaiDB, type BuildDetailCacheRecord } from '$lib/jkai/pwa/db';

  let { data } = $props();

  // Reactive view of `data` that we can swap from cache (offline) or refresh
  // from network. The downstream components consume `data.build`,
  // `data.iterations`, `data.logs`, `data.v3` so we keep the same shape and
  // re-key on change.
  let view = $state<any>(data);
  let renderKey = $state(0);

  onMount(async () => {
    const id = page.params.id;
    if (!id) return;

    // 1. Hydrate from IndexedDB cache if SSR didn't provide a build (offline cold load).
    try {
      const db = await openJkaiDB();
      const cached = (await db.get('buildDetail', id)) as
        | (BuildDetailCacheRecord & { build?: unknown; iterations?: unknown; logs?: unknown })
        | undefined;
      db.close();
      if (cached && !view?.build) {
        view = {
          build: (cached as any).build ?? null,
          iterations: ((cached as any).iterations as unknown[]) ?? [],
          logs: ((cached as any).logs as unknown[]) ?? [],
          v3: view?.v3 ?? false,
        };
        renderKey += 1;
      }
    } catch {
      // IndexedDB unavailable — skip
    }

    // 2. Refresh from network and update cache.
    try {
      const res = await fetch(`/api/jkai/builds/${id}`, { credentials: 'include' });
      if (!res.ok) return;
      const fresh = await res.json();
      // API returns the build with `iterations` merged in (see /api/jkai/builds/[id]/+server.ts).
      const { iterations, ...buildOnly } = fresh ?? {};
      view = {
        build: buildOnly,
        iterations: iterations ?? view?.iterations ?? [],
        logs: view?.logs ?? [],
        v3: view?.v3 ?? false,
      };
      renderKey += 1;

      try {
        const db2 = await openJkaiDB();
        await db2.put('buildDetail', {
          id,
          build: buildOnly,
          iterations: iterations ?? [],
          logs: view.logs,
          fetchedAt: new Date().toISOString(),
        });
        db2.close();
      } catch {
        // ignore cache write failure
      }
    } catch {
      // offline — keep cached/SSR view
    }
  });
</script>

{#key renderKey}
  {#if view?.v3}
    <BuildSession data={view} />
  {:else}
    <BuildDetailV2 data={view} />
  {/if}
{/key}
