<script lang="ts">
  import { onMount } from 'svelte';
  import BuildsListV2 from '$lib/builds/BuildsListV2.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
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
  The page header lives here, not inside BuildsListV2. It is page chrome, and a
  list component that renders the page's own title cannot be reused anywhere
  else — which is also what made $lib/builds (a feature module) import
  $lib/components. Mirrors /jkai/canvas, which does the same thing.

  Outside the {#key} block deliberately: a cache rehydrate or network refresh
  re-keys the list, and there is no reason to tear the header down with it.
-->
<PageHeader title="Builds">
  {#snippet meta()}
    <span class="idx-head-meta">
      <span>{builds.length} {builds.length === 1 ? 'build' : 'builds'}</span>
    </span>
  {/snippet}
</PageHeader>

{#key renderKey}
  <BuildsListV2 builds={builds as any} lanes={data?.lanes ?? []} />
{/key}

<style>
  /* Rendered inside the ink `.site-nav-bar`, so cream at an alpha rather than
     --text-muted, which is ink on ink there. */
  .idx-head-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: rgba(237, 228, 212, 0.62);
  }
</style>
