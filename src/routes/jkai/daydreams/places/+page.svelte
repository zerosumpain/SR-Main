<script lang="ts">
  /**
   * Places — where the household actually goes, and what it is called.
   *
   * A stay of ten minutes makes a place; three separate DAYS makes a question.
   * Days, not person-visits: five people in one car on one afternoon is one
   * day, and asking "what is this place you keep going to?" about it is wrong.
   *
   * The room opens on the rollup because "how many places are there" was the
   * question the old tab could not answer — it landed straight on a list of
   * rows, and the four states a place can be in (a question, too quiet to ask
   * about, named, transit) were only inferable by counting cards.
   */
  import { postThought } from '$lib/daydream/feed-client';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { Facet, RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import { TONE_RANK, placeTone } from '$lib/daydream/priority';
  import PlacesNamingSession from '$lib/components/jkai/daydream/rooms/PlacesNamingSession.svelte';
  import PlacesNameForm from '$lib/components/jkai/daydream/rooms/PlacesNameForm.svelte';
  import { PLACE_KINDS, rhythm } from '$lib/components/jkai/daydream/rooms/places-shared';

  let { data }: { data: PageData } = $props();

  type Place = PageData['places'][number];

  const places = $derived(data.places ?? []);
  /** The threshold comes from the ledger (`MIN_VISITS_TO_ASK`), not a local
   *  copy that drifts; the fallback only covers the load-error path. */
  const askAtVisits = $derived(data.delivery?.minVisitsToAsk ?? 3);

  /** Places worth asking about. The one- and two-day ones still exist and still
   *  match offers and proximity — they are simply not questions. */
  const unnamed = $derived(
    places.filter((p) => !p.label && p.status === 'active' && p.distinctDays >= askAtVisits),
  );
  const quietUnnamed = $derived(
    places.filter((p) => !p.label && p.status === 'active' && p.distinctDays < askAtVisits).length,
  );
  const named = $derived(places.filter((p) => p.label && p.status === 'active'));
  /** Clusters the trail passes THROUGH. Reported rather than hidden: half the
   *  place table was road before the stillness rule, and a count that silently
   *  drops from 160 to 82 looks like data loss unless the page says why. */
  const transitPlaces = $derived(places.filter((p) => p.status === 'transit').length);
  const namedWithMemory = $derived(named.filter((p) => p.hasMemory).length);
  /** What the session will actually offer: `listNamingQueue` is every ACTIVE
   *  place with no label, which is these two added together. The hub rail's
   *  `unnamedPlaces` is a different number — it counts transit and muted rows
   *  too — and putting it on this button would promise a queue longer than the
   *  one that opens. */
  const namingQueueSize = $derived(unnamed.length + quietUnnamed);

  // ── Ordering ──────────────────────────────────────────────────────────────
  // `priority` is the default, as it is on every list on this hub: the shared
  // tone rank puts what is waiting on you first and what is merely true last.
  type PlaceOrder = 'priority' | 'days' | 'recent';
  let placeOrder = $state<PlaceOrder>('priority');

  const placeOrderFacets = $derived<Facet[]>([
    { id: 'priority', label: 'Priority' },
    { id: 'days', label: 'Most days' },
    { id: 'recent', label: 'Most recent' },
  ]);

  function orderPlaces(list: Place[]): Place[] {
    const rows = [...list];
    if (placeOrder === 'days') {
      return rows.sort(
        (a, b) => (b.distinctDays ?? 0) - (a.distinctDays ?? 0) || b.visitCount - a.visitCount,
      );
    }
    if (placeOrder === 'recent') {
      return rows.sort(
        (a, b) => new Date(b.lastSeenAt ?? 0).getTime() - new Date(a.lastSeenAt ?? 0).getTime(),
      );
    }
    return rows.sort(
      (a, b) =>
        TONE_RANK[placeTone(a, askAtVisits)] - TONE_RANK[placeTone(b, askAtVisits)] ||
        (b.distinctDays ?? 0) - (a.distinctDays ?? 0),
    );
  }
  const unnamedOrdered = $derived(orderPlaces(unnamed));
  const namedOrdered = $derived(orderPlaces(named));

  // ── The rollup ────────────────────────────────────────────────────────────
  /** Every kind that has a named place, in the offered order first so the grid
   *  reads the same whether or not the gym has been answered for yet — then
   *  anything the clusterer wrote that is not on the answer list (`unknown`),
   *  which is a fact about the table and must not be quietly dropped. */
  const kindOrder = $derived.by(() => {
    const extra = [...new Set(named.map((p) => p.kind))].filter(
      (k) => !(PLACE_KINDS as readonly string[]).includes(k),
    );
    return [...PLACE_KINDS, ...extra.sort()];
  });
  const namedByKind = $derived.by(() => {
    const counts = new Map<string, { n: number; mem: number }>();
    for (const p of named) {
      const row = counts.get(p.kind) ?? { n: 0, mem: 0 };
      row.n += 1;
      if (p.hasMemory) row.mem += 1;
      counts.set(p.kind, row);
    }
    return counts;
  });

  /** Which kind the named table is showing. Set from the rollup, so a cell is
   *  a way IN to the rows rather than a figure you have to go and find. */
  let kindFilter = $state<string | null>(null);

  function jumpTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function pickKind(k: string) {
    kindFilter = kindFilter === k ? null : k;
    jumpTo('dd-named');
  }

  const rollup = $derived.by((): RollupCell[] => {
    const cells: RollupCell[] = [
      {
        key: 'ask',
        label: 'To name',
        value: String(unnamed.length),
        tone: unnamed.length ? 'action' : 'good',
        corner: `${askAtVisits}+ days`,
        sub: unnamed.length
          ? 'Visited often enough to be a question. Several detectors stay silent until each has a name.'
          : 'Nothing is waiting on an answer.',
        onclick: () => jumpTo('dd-unnamed'),
      },
      {
        key: 'quiet',
        label: 'Too quiet to ask',
        value: String(quietUnnamed),
        tone: quietUnnamed ? 'watch' : 'quiet',
        corner: `under ${askAtVisits}`,
        sub: 'Unnamed and never interrupted about — but they are in the session.',
        onclick: quietUnnamed ? () => jumpTo('dd-unnamed') : null,
      },
      {
        key: 'named',
        label: 'Named',
        value: String(named.length),
        tone: named.length ? 'good' : 'quiet',
        corner: 'facts',
        sub: `${namedWithMemory} of them written into memory.`,
        onclick: named.length ? () => jumpTo('dd-named') : null,
      },
      {
        key: 'transit',
        label: 'Transit',
        value: String(transitPlaces),
        tone: 'quiet',
        corner: 'set aside',
        sub: 'Clusters the trail passes through rather than stops at — never asked about.',
      },
    ];
    for (const k of kindOrder) {
      const row = namedByKind.get(k);
      const n = row?.n ?? 0;
      cells.push({
        key: `kind:${k}`,
        label: k,
        value: String(n),
        tone: n ? 'steady' : 'quiet',
        corner: 'kind',
        sub: n ? `${row?.mem ?? 0} in memory` : 'nothing answered this way yet',
        onclick: n ? () => pickKind(k) : null,
        active: kindFilter === k,
      });
    }
    return cells;
  });

  const namedShown = $derived(
    kindFilter ? namedOrdered.filter((p) => p.kind === kindFilter) : namedOrdered,
  );

  // ── Naming one place, inline ──────────────────────────────────────────────
  let namingPlace = $state<string | null>(null);
  let sessionOpen = $state(false);
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  async function post(body: Record<string, unknown>, key: string) {
    busy = key;
    actionError = null;
    const r = await postThought(body);
    if (!r.ok) actionError = r.error ?? 'that did not work';
    else await invalidateAll();
    busy = null;
    return r.ok;
  }

  /**
   * Scroll to the row a `#place-…` fragment names.
   *
   * The browser resolves a fragment at navigation time, which is BEFORE this
   * page has rendered its lists — so the element does not exist yet and the
   * jump silently does nothing. Re-doing it after paint is the fix;
   * `requestAnimationFrame` is enough because the rows are already in the page
   * payload and need no fetch. The tracked read is the URL and the write is
   * untracked, so it cannot re-trigger on its own effect.
   */
  $effect(() => {
    const hash = page.url.hash;
    untrack(() => {
      if (!hash.startsWith('#place-')) return;
      requestAnimationFrame(() => {
        document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'center' });
      });
    });
  });
</script>

<!-- ── A / THE ROLLUP ────────────────────────────────────────────────────
     The old tab opened on a list of cards, so "how many places are there, and
     how many are still questions" took counting. Four states and every kind,
     in one object. -->
<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / Every place you stop"
      title={['Dots, questions', 'and facts']}
      strap="A stay of ten minutes makes a place; three separate days makes a question. This is the whole table in the four states a place can be in, and the kinds already answered for."
    />

    {#if data.loadError}
      <LoadErrorCard kicker="The place ledger could not be read" message={data.loadError} />
    {/if}

    <RollupGrid cells={rollup} min={172} />

    {#if !unnamed.length && !quietUnnamed && !named.length}
      <div class="card t-quiet empty">
        <p class="card-body">
          No places yet.
          {#if transitPlaces}
            {transitPlaces} {transitPlaces === 1 ? 'cluster is' : 'clusters are'} set aside as
            transit — points the trail passes through rather than stops at.
          {/if}
        </p>
      </div>
    {/if}

    {#if actionError}<p class="err">{actionError}</p>{/if}
  </div>
</section>

<!-- ── B / UNNAMED PLACES ────────────────────────────────────────────────
     Before the named table on purpose. Several detectors are inert until a
     place has a name, so this is the highest-leverage thing on the whole hub. -->
{#if unnamed.length || quietUnnamed}
  <section class="band sunken anchored" id="dd-unnamed">
    <div class="inner">
      <SectionHead
        kicker="B / What is this place?"
        title={['A name turns', 'a dot into a fact']}
        strap="Several detectors stay silent until a place has one. A page you opened is attention you offered, so naming thirty here costs none of the interruption budget four-a-day protects."
      >
        {#snippet aside()}
          {#if sessionOpen}
            <button type="button" class="btn" onclick={() => (sessionOpen = false)}>
              Close the session
            </button>
          {:else}
            <button type="button" class="cta" onclick={() => (sessionOpen = true)}>
              Name them in one go — {namingQueueSize} waiting
            </button>
          {/if}
        {/snippet}
      </SectionHead>

      <p class="lede">
        Each one arrives with a suggested name and address the background geocoder wrote hours
        ago — the difference between a confirmation and a memory test.
        {#if transitPlaces}
          {transitPlaces} more {transitPlaces === 1 ? 'cluster is' : 'clusters are'} set aside as
          transit — never asked about.
        {/if}
        {#if quietUnnamed}
          {quietUnnamed} of them {quietUnnamed === 1 ? 'has' : 'have'} been visited on fewer than
          {askAtVisits} separate days, so {quietUnnamed === 1 ? 'it is' : 'they are'} never
          interrupted about — but {quietUnnamed === 1 ? 'it is' : 'they are'} in the session.
        {/if}
      </p>

      {#if sessionOpen}
        <PlacesNamingSession />
      {:else}
        <div class="controls">
          <FacetBar
            label="Order"
            active={placeOrder}
            facets={placeOrderFacets}
            onpick={(id) => (placeOrder = id as PlaceOrder)}
          />
        </div>

        <div class="stack tight">
          {#each unnamedOrdered as p (p.id)}
            <!-- The anchor a feed card's "In Places" link lands on. Without an
                 id here that link reaches the room and then leaves you to find
                 the row yourself, which on a list of thirty is not a
                 clickthrough. `.anchored` clears the sticky rail. -->
            <div id="place-{p.id}" class="card t-{placeTone(p, askAtVisits)} row anchored">
              <div class="row-id">
                <!-- The geocoder's guess, marked as a guess. Without it every
                     card in this list reads "somewhere you stop" and the
                     question is a memory test rather than a confirmation. -->
                <p class="card-title as-text">
                  {p.suggestedLabel ?? p.suggestedAddress ?? 'Somewhere you stop'}
                </p>
                <p class="card-kicker">
                  {rhythm(p)}{p.suggestedLabel ? ' · suggested, check it' : ''}
                </p>
              </div>
              {#if namingPlace !== p.id}
                <div class="row-controls">
                  <button type="button" class="cta" onclick={() => (namingPlace = p.id)}>Name it</button>
                  <button
                    type="button"
                    class="btn danger"
                    disabled={busy === `ignore:${p.id}`}
                    onclick={() => post({ action: 'ignore_place', placeId: p.id }, `ignore:${p.id}`)}
                  >Stop asking</button>
                </div>
              {:else}
                <PlacesNameForm
                  placeId={p.id}
                  lat={p.lat}
                  lon={p.lon}
                  radiusM={p.radiusM}
                  onclose={() => (namingPlace = null)}
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>
{/if}

<!-- ── C / NAMED PLACES ──────────────────────────────────────────────── -->
{#if named.length}
  <section class="band anchored" id="dd-named">
    <div class="inner">
      <SectionHead
        kicker="C / Named"
        title={['Ground it', 'already knows']}
        strap="A named place is quoted back as fact, so it is only ever written from your answer — never from the geocoder's guess."
      />
      <div class="controls">
        <FacetBar
          label="Order"
          active={placeOrder}
          facets={placeOrderFacets}
          onpick={(id) => (placeOrder = id as PlaceOrder)}
        />
        {#if kindFilter}
          <p class="field-label filter-note">
            Showing {kindFilter} only — {namedShown.length} of {named.length}
            <button type="button" class="btn sm" onclick={() => (kindFilter = null)}>Show every kind</button>
          </p>
        {/if}
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Place</th>
              <th>Kind</th>
              <th>Rhythm</th>
              <th class="right">Days</th>
              <th class="right">In memory</th>
            </tr>
          </thead>
          <tbody>
            {#each namedShown as p (p.id)}
              <tr id="place-{p.id}" class="anchored">
                <td class="cell-lead"><span class="cell-title">{p.label}</span></td>
                <td>{p.kind}</td>
                <td class="cell-wrap">{rhythm(p)}</td>
                <td class="right">{p.distinctDays}</td>
                <td class="right">
                  <span class="pill t-{p.hasMemory ? 'good' : 'watch'}">{p.hasMemory ? 'yes' : 'no'}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </section>
{/if}

<style>
  .empty {
    margin-top: 20px;
  }
  .row-id {
    min-width: 0;
    flex: 1 1 320px;
  }
  .row-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .filter-note {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin: 0;
  }
</style>
