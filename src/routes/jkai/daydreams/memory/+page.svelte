<script lang="ts">
  // ── The Memory room ───────────────────────────────────────────────────────
  //
  // What Daydream has learned, and — the half that was missing — whether any
  // of it changed what gets said next. Three surfaces, one loop:
  //
  //   themes   the distilled lessons and values a ponder pass actually reads
  //   archive  the raw sentences underneath them, the receipts
  //
  // A fourth surface, the reviewer's rulings, went with the reviewer in P4a
  // (2026-09-25). Rulings it had already remembered stay in the archive.
  //
  // Both halves used to be fetched from an effect after the tab opened,
  // because the monolith's payload already carried sixteen loaders for eleven
  // tabs. A room is its own route now, so `+page.server.ts` calls the same
  // server function the API's `memories` handler called and the page arrives
  // populated. The consolidate action still POSTs to the API.
  //
  // The room opens on a ROLLUP rather than on a wall of cards: the four
  // numbers that say whether the loop closes — how many themes reach a pack,
  // how many sentences are still waiting for tonight, how many refutations
  // bind, and how many verdicts were reached and then forgotten.
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import { untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import type { Facet, RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import MemoryThemeCard from '$lib/components/jkai/daydream/rooms/MemoryThemeCard.svelte';
  import MemoryCard from '$lib/components/jkai/daydream/rooms/MemoryCard.svelte';
  import {
    MEMORY_THEMES_PER_PACK,
    groupByCategory,
    groupThemesByKind,
    memoryUse,
    type DaydreamMemory,
  } from '$lib/daydream/memories';
  import { themeKindLabel } from '$lib/daydream/rooms/memory';
  import { postThought } from '$lib/daydream/feed-client';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const memories = $derived(data.memories);
  const themes = $derived(data.themes);
  const lastConsolidation = $derived(data.lastConsolidation);

  function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── The four numbers ──────────────────────────────────────────────────────
  const awaiting = $derived(memories.filter((m) => m.consolidatedAt == null));
  const binding = $derived(memories.filter((m) => memoryUse(m).binding));
  /** The themes a ponder pass can actually reach — the query orders by support,
   *  so the cap is the first N of the list rather than a separate flag. */
  const packIds = $derived(new Set(themes.slice(0, MEMORY_THEMES_PER_PACK).map((t) => t.id)));
  const themeGroups = $derived(groupThemesByKind(themes));

  // One cell per theme kind, then the four. Built from a FIXED kind list rather
  // than from the groups, so an empty store still shows both categories at zero
  // instead of a grid that changes shape as the first lesson lands.
  const THEME_KINDS = ['value', 'lesson'] as const;

  const rollup = $derived.by((): RollupCell[] => {
    const cells: RollupCell[] = THEME_KINDS.map((kind) => {
      const items = themes.filter((t) => t.kind === kind);
      const sources = items.reduce((n, t) => n + t.sourceCount, 0);
      const cited = items.reduce((n, t) => n + t.influenced.length, 0);
      return {
        key: `theme-${kind}`,
        label: themeKindLabel(kind),
        mark: kind === 'value' ? 'VALUE' : 'LESSON',
        value: String(items.length),
        tone: cited ? 'good' : items.length ? 'steady' : 'quiet',
        sub: `${sources} source${sources === 1 ? '' : 's'} · cited by ${cited} thought${cited === 1 ? '' : 's'}`,
        href: '#dd-memory-themes',
      };
    });

    cells.push({
      key: 'pack',
      label: 'Memories in the pack',
      value: String(Math.min(themes.length, MEMORY_THEMES_PER_PACK)),
      suffix: `/${MEMORY_THEMES_PER_PACK}`,
      tone: themes.length > MEMORY_THEMES_PER_PACK ? 'watch' : 'steady',
      corner: 'cap',
      sub:
        themes.length > MEMORY_THEMES_PER_PACK
          ? `${themes.length - MEMORY_THEMES_PER_PACK} theme${themes.length - MEMORY_THEMES_PER_PACK === 1 ? '' : 's'} sit outside the cap and reach no ponder`
          : 'every theme fits in a reasoning pass',
      href: '#dd-memory-themes',
    });

    cells.push({
      key: 'awaiting',
      label: 'Awaiting consolidation',
      value: String(awaiting.length),
      tone: awaiting.length ? 'watch' : 'good',
      sub: awaiting.length
        ? 'raw sentences waiting for tonight’s 22:30 pass; none of them guides a daydream yet'
        : 'every raw memory has been through a nightly pass',
      href: '#dd-memories',
    });

    cells.push({
      key: 'archive',
      label: 'Raw memories kept',
      value: String(memories.length),
      tone: 'quiet',
      sub: 'reviewer findings and notes you left on thoughts — the receipts behind the themes',
      href: '#dd-memories',
    });

    cells.push({
      key: 'binding',
      label: 'Binding refutations',
      value: String(binding.length),
      tone: binding.length ? 'urgent' : 'quiet',
      sub: binding.length
        ? 'repeated to the proposer as claims never to raise again in any wording'
        : 'nothing has been disproven hard enough to bind the proposer',
      href: '#dd-memories',
    });

    return cells;
  });

  // ── Section C: the raw archive, filtered ──────────────────────────────────
  let memCategory = $state('all');
  let memOrigin = $state('all');

  const memoriesVisible = $derived(
    memories.filter(
      (m) =>
        (memCategory === 'all' || m.category === memCategory) &&
        (memOrigin === 'all' || m.origin === memOrigin),
    ),
  );
  const memoryGroups = $derived(groupByCategory(memoriesVisible));

  // Each facet bar counts within the OTHER one's selection, so the numbers
  // describe what picking a chip would actually give you.
  const memCategoryFacets = $derived.by((): Facet[] => {
    const scope = memories.filter((m) => memOrigin === 'all' || m.origin === memOrigin);
    return [
      { id: 'all', label: 'All', count: scope.length },
      ...groupByCategory(scope).map((g) => ({
        id: g.category,
        label: cap(g.category),
        count: g.items.length,
      })),
    ];
  });

  const memOriginFacets = $derived.by((): Facet[] => {
    const scope = memories.filter((m) => memCategory === 'all' || m.category === memCategory);
    const n = (origin: DaydreamMemory['origin']) => scope.filter((m) => m.origin === origin).length;
    return [
      { id: 'all', label: 'All', count: scope.length },
      { id: 'ruling', label: 'It checked', count: n('ruling') },
      { id: 'note', label: 'You told it', count: n('note') },
    ];
  });

  /**
   * Scroll to the theme a `#memory-theme-…` fragment names.
   *
   * Evidence trails elsewhere on the hub link straight at one theme. The
   * browser resolves a fragment at navigation time, which on a client-side
   * navigation is BEFORE this room has painted, so the element does not exist
   * yet and the jump silently does nothing. Re-doing it after a frame is the
   * fix; the themes ride the page payload, so one `requestAnimationFrame` is
   * enough. Tracked read is the hash, the work is untracked.
   */
  $effect(() => {
    const hash = page.url.hash;
    untrack(() => {
      if (!hash.startsWith('#memory-theme-')) return;
      requestAnimationFrame(() => {
        document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'center' });
      });
    });
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  let refreshing = $state(false);
  let consolidating = $state(false);
  let consolidationNote = $state<string | null>(null);
  let consolidationError = $state<string | null>(null);

  async function refresh() {
    refreshing = true;
    try {
      await invalidateAll();
    } finally {
      refreshing = false;
    }
  }

  function consolidationSummary(result: {
    memoriesReviewed: number;
    themesCreated: number;
    themesUpdated: number;
  }): string {
    return result.memoriesReviewed
      ? `Reviewed ${result.memoriesReviewed}: ${result.themesCreated} themes created and ${result.themesUpdated} updated.`
      : 'Nothing new was waiting for consolidation.';
  }

  /**
   * A visible bootstrap/retry for the nightly process.
   *
   * A production-sized pass outlives Cloudflare's 100-second limit, so the
   * endpoint answers 202 as soon as the run row is claimed and the work carries
   * on server-side. The page then polls the DURABLE status rather than the
   * request — which is why a gateway timeout can no longer make successful work
   * look like a failure. Polling is `invalidateAll()` now that the overview
   * rides the page payload.
   */
  async function consolidateNow() {
    consolidating = true;
    consolidationError = null;
    consolidationNote = null;
    try {
      const { ok, out, error } = await postThought<{
        accepted?: boolean;
        localDay?: string;
        result?: {
          status: string;
          memoriesReviewed: number;
          themesCreated: number;
          themesUpdated: number;
          error?: string | null;
        };
      }>({ action: 'consolidate_memories' });
      if (!ok) throw new Error(error ?? 'consolidation request failed');

      await invalidateAll();

      if (!out.accepted) {
        if (!out.result) throw new Error('consolidation returned no result');
        consolidationNote = consolidationSummary(out.result);
        return;
      }

      consolidationNote = 'Consolidation is running in the background…';
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
        await invalidateAll();
        const latest = data.lastConsolidation;
        if (!latest || (out.localDay && latest.localDay !== out.localDay) || latest.status === 'running') {
          continue;
        }
        if (latest.status === 'failed') {
          throw new Error(latest.error ?? 'the consolidator failed without recording a reason');
        }
        consolidationNote = consolidationSummary(latest);
        return;
      }

      consolidationNote =
        'Consolidation is still running in the background. You can leave this page and refresh later.';
    } catch (err) {
      consolidationError = err instanceof Error ? err.message : String(err);
    } finally {
      consolidating = false;
    }
  }
</script>

<!-- ── A / The rollup ────────────────────────────────────────────────────── -->
<section class="band" id="dd-memory-rollup">
  <div class="inner">
    {#if data.loadError}
      <LoadErrorCard kicker="The memory store could not be read" message={data.loadError} />
    {/if}

    <SectionHead
      kicker="A / What it has learned"
      title={['Everything it knows,', 'counted']}
      strap="Two stores and one loop: raw sentences written by the reviewer and by your notes, and the lessons and values the nightly pass distils from them. Every figure is a link into the part of the room it counts."
    >
      {#snippet aside()}
        <button type="button" class="btn" disabled={refreshing} onclick={refresh}>
          {refreshing ? 'Reading…' : 'Refresh'}
        </button>
        <button
          type="button"
          class="cta"
          disabled={consolidating || awaiting.length === 0}
          onclick={consolidateNow}
        >
          {consolidating ? 'Consolidating…' : `Consolidate now${awaiting.length ? ` (${awaiting.length})` : ''}`}
        </button>
      {/snippet}
    </SectionHead>

    <RollupGrid cells={rollup} min={210} />

    {#if consolidationNote}<p class="note good">{consolidationNote}</p>{/if}
    {#if consolidationError}<p class="note warn">Consolidation failed: {consolidationError}</p>{/if}
  </div>
</section>

<!-- ── B / Lessons and values ───────────────────────────────────────────────
     The normal reasoning surface. Raw memories remain underneath as the
     receipts, while these sourced themes are what a future ponder cites. -->
<section class="band sunken" id="dd-memory-themes">
  <div class="inner">
    <SectionHead
      kicker="B / Lessons and values"
      title={['What the details', 'have taught it']}
      strap="At 22:30 each night, a model reviews Daydream's own findings—the reviewer's rulings and notes you left on thoughts—and folds them into broader lessons and explicit values. Memories from chat or elsewhere on the site never enter this loop."
    />

    <div class="card t-steady">
      <p class="card-body">
        <strong>The theme is what future daydreams read.</strong> A raw memory is the receipt:
        it proves why the lesson exists, but after consolidation its thought-specific wording
        no longer occupies the prompt. Up to {MEMORY_THEMES_PER_PACK} themes reach a ponder
        pass, ordered by how many memories support them.
      </p>
      {#if lastConsolidation}
        <p class="card-body">
          Latest consolidation: <strong>{lastConsolidation.status}</strong> for
          {lastConsolidation.localDay} · {lastConsolidation.memoriesReviewed} memories reviewed ·
          {lastConsolidation.themesCreated} themes created · {lastConsolidation.themesUpdated}
          updated · {lastConsolidation.memoriesIgnored} archive-only{lastConsolidation.model ? ` · ${lastConsolidation.model}` : ''}.
        </p>
        {#if lastConsolidation.error}<p class="err">{lastConsolidation.error}</p>{/if}
      {/if}
    </div>

    {#if themes.length === 0}
      <div class="card t-quiet section-gap">
        <p class="card-body">
          No themes yet. {awaiting.length
            ? `${awaiting.length} raw memories are waiting for tonight’s first consolidation.`
            : 'A note, named place, ruling, or conversation memory will give the nightly pass its first source.'}
        </p>
      </div>
    {:else}
      {#each themeGroups as group (group.kind)}
        <div class="group">
          <span class="group-label">{themeKindLabel(group.kind)}</span>
          <span class="group-n">{group.items.length}</span>
          <span class="group-rule"></span>
        </div>
        <div class="stack">
          {#each group.items as theme (theme.id)}
            <MemoryThemeCard {theme} inPack={packIds.has(theme.id)} />
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</section>

<!-- ── C / Source archive ───────────────────────────────────────────────────
     The append-only receipts. These explain the roll-up but, once
     consolidated, no longer compete for slots in the reasoning pack. -->
<section class="band" id="dd-memories">
  <div class="inner">
    <SectionHead
      kicker="C / Source archive"
      title={['The memories', 'underneath the themes']}
      strap="Only notes left on Daydream thoughts and findings produced by the Daydream reviewer. New details wait here until tonight; memories from chat, named places, and the rest of the site are outside this learning loop."
    />

    {#if memories.length}
      <div class="controls">
        <FacetBar label="Category" active={memCategory} facets={memCategoryFacets} onpick={(id) => (memCategory = id)} />
        <FacetBar label="Written by" active={memOrigin} facets={memOriginFacets} onpick={(id) => (memOrigin = id)} />
      </div>
    {/if}

    {#if memoriesVisible.length === 0}
      <div class="card t-quiet"><p class="card-body">No raw memories in this view.</p></div>
    {/if}

    {#each memoryGroups as g (g.category)}
      <div class="group">
        <span class="group-label">{g.category}</span>
        <span class="group-n">{g.items.length}</span>
        <span class="group-rule"></span>
      </div>
      <div class="grid">
        {#each g.items as m (m.id)}
          <MemoryCard memory={m} />
        {/each}
      </div>
    {/each}
  </div>
</section>

<style>
  /* Room-specific only — band, card, pill, tag, grid, stack, controls, note and
     the rest come from the layout's `.ds-vocab` vocabulary. */

  /* The load fault sits above the section head, which owns its own bottom
     margin; the card owns none. */
  .load-error {
    margin-bottom: clamp(20px, 2.6vw, 32px);
  }

  /* A heading that is NOT a toggle: the feed's groups collapse, these are fixed
     categories with nothing to fold, and a button that does nothing is worse
     than a heading. */
  .group {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    margin: 30px 0 6px;
  }
  .group:first-of-type {
    margin-top: 0;
  }
  .group-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .group-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .group-rule {
    flex: 1 1 40px;
    height: 1px;
    background: var(--line);
  }
</style>
