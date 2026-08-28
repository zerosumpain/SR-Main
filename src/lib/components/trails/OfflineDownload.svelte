<script lang="ts">
  // Offline tile download for one route. Browser-only: everything here talks
  // to IndexedDB and the tile server, never to our own backend.
  import { onMount, onDestroy } from 'svelte';
  import { formatBytes, type TileBounds } from '$lib/trails/field/tile-math';

  let {
    routeId,
    routeName,
    bounds,
  }: {
    routeId: string;
    routeName: string;
    bounds: TileBounds;
  } = $props();

  let minZoom = $state(12);
  let maxZoom = $state(16);

  let estimate = $state<{ tiles: number; bytes: number } | null>(null);
  let progress = $state<{ done: number; total: number; bytes: number; failed: number } | null>(null);
  let region = $state<{ status: string; tileCount: number; bytes: number } | null>(null);
  let usage = $state<{ tiles: number; bytes: number } | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  // AbortController is machinery, not reactive state.
  let controller: AbortController | null = null;

  async function refresh() {
    const { getRegion, cacheUsage } = await import('$lib/trails/field/tile-store');
    const [r, u] = await Promise.all([getRegion(routeId), cacheUsage()]);
    region = r ? { status: r.status, tileCount: r.tileCount, bytes: r.bytes } : null;
    usage = u;
  }

  async function recalculate() {
    const { planDownload } = await import('$lib/trails/field/tile-store');
    const plan = planDownload(bounds, minZoom, maxZoom);
    estimate = { tiles: plan.tiles.length, bytes: plan.estimatedBytes };
  }

  onMount(() => {
    refresh().catch(() => {});
    recalculate().catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });

  onDestroy(() => controller?.abort());

  // Re-estimate when the zoom range changes. Reads only props/state it does
  // not write, so it cannot re-trigger itself.
  $effect(() => {
    void minZoom;
    void maxZoom;
    recalculate().catch(() => {});
  });

  async function download() {
    busy = true;
    error = null;
    progress = null;
    controller = new AbortController();
    try {
      const { downloadRegion } = await import('$lib/trails/field/tile-store');
      await downloadRegion({
        routeId,
        name: routeName,
        bounds,
        minZoom,
        maxZoom,
        signal: controller.signal,
        onProgress: (p) => (progress = p),
      });
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      controller = null;
    }
  }

  function cancel() {
    controller?.abort();
  }

  async function remove() {
    const { deleteRegion } = await import('$lib/trails/field/tile-store');
    await deleteRegion(routeId);
    progress = null;
    await refresh();
  }
</script>

<div class="offline">
  <div class="zooms">
    <label class="field">
      <span class="sr-label-tight">Min zoom</span>
      <input class="nm-text-input" type="number" min="8" max="17" bind:value={minZoom} />
    </label>
    <label class="field">
      <span class="sr-label-tight">Max zoom</span>
      <input class="nm-text-input" type="number" min="9" max="18" bind:value={maxZoom} />
    </label>
    <div class="field">
      <span class="sr-label-tight">Estimate</span>
      <span class="value">
        {#if estimate}{estimate.tiles} tiles · ~{formatBytes(estimate.bytes)}{:else}—{/if}
      </span>
    </div>
  </div>

  {#if progress}
    <div class="progress">
      <div class="bar"><span style:width="{(progress.done / Math.max(1, progress.total)) * 100}%"></span></div>
      <span class="progress-text">
        {progress.done} / {progress.total} · {formatBytes(progress.bytes)}
        {#if progress.failed}· {progress.failed} failed{/if}
      </span>
    </div>
  {/if}

  <div class="actions">
    {#if busy}
      <button class="nm-save-btn" onclick={cancel}>Cancel</button>
    {:else}
      <button class="nm-save-btn" onclick={download}>
        {region ? 'Top up offline map' : 'Download for offline'}
      </button>
    {/if}
    {#if region}
      <button class="row-link danger" onclick={remove}>Delete cached tiles</button>
    {/if}
  </div>

  <p class="note">
    {#if region}
      Cached: {region.tileCount} tiles, {formatBytes(region.bytes)} ({region.status}).
    {:else}
      Nothing cached for this route yet.
    {/if}
    {#if usage}
      Whole cache: {usage.tiles} tiles, {formatBytes(usage.bytes)}.
    {/if}
  </p>

  <p class="note quiet">
    Tiles download one at a time on purpose — OpenStreetMap's tile policy asks for no bulk
    fetching, and a blocked home IP would take the map away everywhere, not just here.
  </p>

  {#if error}<p class="error-line">{error}</p>{/if}
</div>

<style>
  .offline {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .zooms {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.9rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .value {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .bar {
    height: 6px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-hair);
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .progress-text,
  .note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    margin: 0;
  }
  .note.quiet {
    color: var(--text-ghost);
    max-width: 62ch;
    line-height: 1.5;
  }
  .actions {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .row-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--accent);
  }
  .row-link.danger {
    color: var(--error);
  }
  .error-line {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--error);
  }
</style>
