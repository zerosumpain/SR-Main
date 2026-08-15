<script lang="ts">
  // The timeline, as an instrument rather than a list.
  //
  // What changed and why:
  //   - events sit on a real time axis, so clustering is visible; a list
  //     grouped by month hid the fact that half of last quarter happened in
  //     one week
  //   - brushing a window filters the list AND the graph beside it. That
  //     linkage IS the feature: "who was active in this fortnight, and how are
  //     they connected" is a question a list cannot answer at all
  //   - a lens narrows the whole page, so the professional and personal halves
  //     of the graph stop being read through each other
  //
  // The network payload is fetched after first paint — the page is useful
  // without it, and the analysis behind it costs a Louvain run.

  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import LensPicker from '$lib/components/intel/LensPicker.svelte';
  import TimelineBrush from '$lib/components/intel/TimelineBrush.svelte';
  import NetworkGraph from '$lib/components/intel/NetworkGraph.svelte';
  import type { NetworkPayload } from '$lib/components/intel/types';
  import { isFullRange, toDateInput, type TimeRange } from '$lib/jkai/intel/lenses';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let { data } = $props();

  const TYPE_COLOURS: Record<string, string> = {
    deadline: 'var(--error)',
    milestone: 'var(--success)',
    event: 'var(--accent-ink)',
    decision: 'var(--warn)',
  };
  const TYPE_FILTERS = ['deadline', 'milestone', 'event', 'decision'];

  let network = $state<NetworkPayload | null>(null);
  let loadingNetwork = $state(true);
  let selectedId = $state<string | null>(null);

  /** Null means "no window brushed" — the whole timeline is in play. */
  let brush = $state<{ range: TimeRange; eventIds: Set<string>; entityIds: Set<string> } | null>(null);

  const visibleEvents = $derived(
    brush ? data.events.filter((e) => brush!.eventIds.has(e.id)) : data.events,
  );

  /** Every entity the timeline touches — the graph's baseline before brushing. */
  const timelineEntityIds = $derived(
    new Set(data.events.map((e) => e.entityId).filter((id): id is string => Boolean(id))),
  );

  const focusIds = $derived(brush ? brush.entityIds : timelineEntityIds);

  // The network payload is filtered client-side rather than refetched: the
  // brush moves continuously, and a request per drag frame would be absurd.
  const graph = $derived.by(() => {
    if (!network) return { nodes: [], edges: [] };
    const nodes = network.nodes.filter((n) => focusIds.has(n.id));
    const keep = new Set(nodes.map((n) => n.id));
    return { nodes, edges: network.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  });

  const rangeLabel = $derived.by(() => {
    if (!brush || isFullRange(brush.range)) return null;
    const from = toDateInput(brush.range.start) || '…';
    const to = toDateInput(brush.range.end) || '…';
    return `${from} → ${to}`;
  });

  function groupByMonth(events: typeof data.events) {
    const groups = new Map<string, typeof data.events>();
    for (const event of events) {
      const month = event.date.slice(0, 7);
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month)!.push(event);
    }
    return [...groups.entries()];
  }

  const grouped = $derived(groupByMonth(visibleEvents));

  function monthLabel(month: string): string {
    const d = new Date(`${month}-01T00:00:00Z`);
    return Number.isNaN(d.getTime())
      ? month
      : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', timeZone: 'UTC' });
  }

  /** Filters live in the URL so a view can be linked and re-entered. */
  function withParams(patch: Record<string, string | null>): string {
    const params = new URLSearchParams();
    if (data.filters.type) params.set('type', data.filters.type);
    if (data.filters.entityId) params.set('entityId', data.filters.entityId);
    if (data.filters.lens) params.set('lens', data.filters.lens);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/jkai/intel/timeline?${qs}` : '/jkai/intel/timeline';
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/jkai/intel/network');
      if (res.ok) network = await res.json();
    } catch {
      // The graph panel is additive; the timeline stands on its own without it.
    } finally {
      loadingNetwork = false;
    }
  });
</script>

<JkaiPageTitle title="TIMELINE" titleHref="/jkai/intel" />

<div class="wrap">
  <div class="toolbar">
    <div class="chips">
      <a class="chip" class:on={!data.filters.type} href={withParams({ type: null })}>All</a>
      {#each TYPE_FILTERS as t (t)}
        <a
          class="chip"
          class:on={data.filters.type === t}
          href={withParams({ type: t })}
          style="--chip: {TYPE_COLOURS[t]};"
        >
          <span class="dot" style="background: {TYPE_COLOURS[t]};"></span>{t}
        </a>
      {/each}
    </div>

    <LensPicker
      lenses={data.lenses}
      activeId={data.activeLens?.id ?? null}
      onSelect={(lens) => goto(withParams({ lens: lens ? lens.slug : null }), { keepFocus: true })}
    />
  </div>

  {#if data.activeLens}
    <p class="lens-note">
      Lens <strong>{data.activeLens.name}</strong> — {data.activeLens.summary}.
      {#if data.hiddenByLens > 0}
        <span class="muted">{data.hiddenByLens} events outside the lens (or with no linked entity) hidden.</span>
      {/if}
    </p>
  {/if}

  {#if data.truncated}
    <p class="lens-note muted">Showing the most recent 500 events — older history is not on this axis.</p>
  {/if}

  {#if data.events.length === 0}
    <div class="empty">
      No timeline events{data.activeLens ? ' in this lens' : ''} yet. Events are extracted automatically
      from your notes.
    </div>
  {:else}
    <TimelineBrush
      events={data.events}
      onChange={({ range, eventIds, entityIds }) => {
        brush = isFullRange(range)
          ? null
          : { range, eventIds: new Set(eventIds), entityIds: new Set(entityIds) };
      }}
    />

    <div class="split">
      <section class="events" aria-label="Events">
        <header class="panel-head">
          <span class="panel-title">Events</span>
          <span class="panel-meta">{rangeLabel ?? 'full history'}</span>
        </header>

        {#if visibleEvents.length === 0}
          <p class="empty small">No events in the selected window.</p>
        {:else}
          <div class="rail">
            {#each grouped as [month, events] (month)}
              <div class="month">
                <div class="month-label">{monthLabel(month)}</div>
                {#each events as event (event.id)}
                  <div class="event" class:sel={selectedId && event.entityId === selectedId}>
                    <span class="pip" style="background: {TYPE_COLOURS[event.type] ?? 'var(--text-ghost)'};"></span>
                    <div class="event-body">
                      <div class="event-meta">
                        <span>{event.date}</span>
                        {#if event.dateEnd}<span>— {event.dateEnd}</span>{/if}
                        <span
                          class="type"
                          style="border-color: {TYPE_COLOURS[event.type] ?? 'var(--card-border)'}; color: {TYPE_COLOURS[event.type] ?? 'var(--text-muted)'};"
                        >{event.type}</span>
                      </div>
                      <div class="event-title">{event.title}</div>
                      {#if event.description}
                        <div class="event-desc">{event.description}</div>
                      {/if}
                      {#if event.entityName}
                        <a class="event-entity" href="/jkai/intel/entities/{event.entityId}">
                          {event.entityTypeIcon} {event.entityName}
                        </a>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <section class="graph" aria-label="Entities active in the selected window">
        <header class="panel-head">
          <span class="panel-title">Who was active</span>
          <span class="panel-meta">{graph.nodes.length} entities · {graph.edges.length} links</span>
        </header>

        <div class="canvas">
          {#if loadingNetwork && !network}
            <p class="empty small">Analysing the graph…</p>
          {:else if graph.nodes.length === 0}
            <p class="empty small">
              {network ? 'No linked entities in this window.' : 'Graph unavailable.'}
            </p>
          {:else}
            <NetworkGraph
              nodes={graph.nodes}
              edges={graph.edges}
              {selectedId}
              onSelect={(id) => (selectedId = id)}
              onOpen={(id) => goto(`/jkai/intel/entities/${id}`)}
            />
          {/if}
        </div>
      </section>
    </div>
  {/if}
</div>

<style>
  .wrap {
    /* Full-bleed, like every Intel surface — a centred column beside a
       full-width graph read as a bug. Prose keeps its own measure below. */
    width: 100%;
    padding: 24px 20px 48px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    background: var(--card-bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    text-decoration: none;
    transition: border-color var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
  }
  .chip:hover {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .chip.on {
    background: var(--accent-tint-08);
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
  }

  .lens-note {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .muted {
    color: var(--text-ghost);
  }

  .empty {
    padding: 40px 16px;
    text-align: center;
    color: var(--text-ghost);
    font-size: var(--fs-body-sm);
  }
  .empty.small {
    padding: 20px 12px;
    font-size: var(--fs-label);
  }

  .split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }
  @media (max-width: 900px) {
    .split {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .events,
  .graph {
    background: var(--card-bg);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    overflow: hidden;
  }

  .panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--line-hair);
  }
  .panel-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .panel-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .rail {
    max-height: 560px;
    overflow-y: auto;
    padding: 12px;
  }
  .month + .month {
    margin-top: 16px;
  }
  .month-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    margin-bottom: 6px;
  }

  .event {
    display: flex;
    gap: 9px;
    padding: 7px 0 7px 2px;
    border-left: 1px solid var(--line-hair);
    padding-left: 12px;
    position: relative;
  }
  .event.sel {
    border-left-color: var(--accent);
  }
  .pip {
    position: absolute;
    left: -3.5px;
    top: 13px;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
  }
  .event-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .event-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .type {
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    padding: 0 5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .event-title {
    font-size: var(--fs-body-sm);
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }
  .event-desc {
    font-size: var(--fs-label);
    color: var(--text-secondary);
    line-height: 1.45;
  }
  .event-entity {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    text-decoration: none;
  }
  .event-entity:hover {
    text-decoration: underline;
  }

  .canvas {
    position: relative;
    height: 520px;
  }
</style>
