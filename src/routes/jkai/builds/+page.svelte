<script lang="ts">
  import { onMount } from 'svelte';
  import BuildsListV2 from '$lib/builds/BuildsListV2.svelte';
  import { listBuilds, putBuild, type BuildCacheRecord } from '$lib/jkai/pwa/db';

  let { data } = $props();

  // Seed render-state from SSR. The child component copies its prop into
  // internal state on mount, so we re-key the child whenever this array is
  // replaced (cache rehydrate / network refresh) to force a fresh seed.
  let builds = $state<any[]>(data?.builds ?? []);
  let renderKey = $state(0);

  function toCacheRecord(b: any): BuildCacheRecord {
    return {
      id: String(b.id),
      title: b.title ?? '',
      status: String(b.status ?? ''),
      createdAt: typeof b.createdAt === 'string'
        ? b.createdAt
        : new Date(b.createdAt ?? Date.now()).toISOString(),
      planSummary: b.planSummary ?? undefined,
    };
  }

  onMount(async () => {
    try {
      const cached = await listBuilds();
      if (cached.length && builds.length === 0) {
        builds = cached as any[];
        renderKey += 1;
      }
    } catch {
      // IndexedDB unavailable — skip cache
    }

    try {
      const res = await fetch('/api/jkai/builds', { credentials: 'include' });
      if (!res.ok) return;
      const fresh = (await res.json()) as any[];
      builds = fresh;
      renderKey += 1;
      for (const b of fresh) {
        try {
          await putBuild(toCacheRecord(b));
        } catch {
          // ignore per-record cache errors
        }
      }
    } catch {
      // offline — keep cached
    }
  });
</script>

{#key renderKey}
  <BuildsListV2 builds={builds as any} lanes={data?.lanes ?? []} />
{/key}
