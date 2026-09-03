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

<!--
  No page header here. `/jkai/builds` sits under the jkai layout, whose
  HubHeader is already the shared bar for this family — it carries the home
  icon and the way back to /jkai. A PageHeader here drew a SECOND
  `.site-nav-bar` directly beneath it, and BuildsListV2's own `.page-hdr` made
  a third band. The build count it used to show is the `total` stat in the
  list's own overview.
-->
{#key renderKey}
  <BuildsListV2 builds={builds as any} lanes={data?.lanes ?? []} />
{/key}

