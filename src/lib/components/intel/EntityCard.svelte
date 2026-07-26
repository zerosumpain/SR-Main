<script lang="ts">
  // What the graph knows about one entity, in a card.
  //
  // Used in two places with the same data: hovering an entity mention in a jkai
  // reply, and clicking a node on the Intel network graph. Fetches lazily and
  // caches per entity id, so hovering the same name repeatedly is free.

  import { fetchEntityCard, type EntityCardData } from '$lib/jkai/intel/entity-card-store';

  let {
    entityId,
    compact = false,
    onCommission,
    onFocus,
  }: {
    entityId: string;
    /** Hover cards are compact; the dashboard panel is not. */
    compact?: boolean;
    onCommission?: (kind: string, payload: string, entityIds: string[]) => void;
    onFocus?: (id: string) => void;
  } = $props();

  let data = $state<EntityCardData | null>(null);
  let loading = $state(true);
  let failed = $state(false);

  // Keyed on entityId so the card reloads when the hovered mention changes.
  $effect(() => {
    const id = entityId;
    loading = true;
    failed = false;
    data = null;
    let cancelled = false;

    fetchEntityCard(id)
      .then((result) => {
        if (cancelled) return;
        data = result;
        loading = false;
      })
      .catch(() => {
        if (cancelled) return;
        failed = true;
        loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  // Not named `props` — that shadows the `$props` rune.
  const entityProps = $derived(
    data ? Object.entries(data.entity.properties ?? {}).filter(([, v]) => v != null && v !== '') : [],
  );

  function pct(n: number): string {
    return `${Math.round(n * 100)}%`;
  }
</script>

<div class="entity-card" class:compact>
  {#if loading}
    <div class="state">Loading…</div>
  {:else if failed || !data}
    <div class="state">Could not load this entity.</div>
  {:else}
    <header>
      <span class="icon" style="color: {data.entity.type.color};">{data.entity.type.icon}</span>
      <div class="head-text">
        <h3>{data.entity.name}</h3>
        <span class="type">{data.entity.type.name}</span>
      </div>
      {#if !data.entity.confirmed}
        <span class="chip unconfirmed" title="Awaiting review">unconfirmed</span>
      {/if}
    </header>

    {#if data.entity.summary}
      <p class="summary">{data.entity.summary}</p>
    {/if}

    <div class="metrics">
      <span title="Direct connections"><b>{data.metrics.degree}</b> links</span>
      <span title="Share of graph importance"><b>{pct(data.metrics.importance)}</b> importance</span>
      <span title="Source notes"><b>{data.metrics.noteCount}</b> sources</span>
      {#if data.metrics.brokerage > 0.01}
        <span class="broker" title="Connects otherwise separate clusters">broker</span>
      {/if}
    </div>

    {#if entityProps.length && !compact}
      <dl class="props">
        {#each entityProps.slice(0, 6) as [key, value]}
          <dt>{key}</dt>
          <dd>{String(value)}</dd>
        {/each}
      </dl>
    {/if}

    {#if data.neighbours.length}
      <section>
        <h4>Connected to</h4>
        <ul class="neighbours">
          {#each data.neighbours.slice(0, compact ? 6 : 14) as n}
            <li>
              <button
                type="button"
                class="neighbour"
                class:cross={n.crossCommunity}
                onclick={() => onFocus?.(n.id)}
                title="{n.relationship} — {n.degree} links"
              >
                <span class="dot" style="background: {n.color};"></span>
                <span class="nb-name">{n.name}</span>
                <span class="rel">{n.relationship}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if data.timeline.length && !compact}
      <section>
        <h4>Timeline</h4>
        <ul class="timeline">
          {#each data.timeline.slice(0, 5) as e}
            <li><time>{e.date}</time> {e.title}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if data.notes.length}
      <section>
        <h4>Sources</h4>
        <ul class="notes">
          {#each data.notes.slice(0, compact ? 3 : 8) as n}
            <li><a href={n.href}>{n.title}</a> <span class="src">{n.source}</span></li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if onCommission}
      <footer>
        <button
          type="button"
          onclick={() => onCommission('research', `Deep dive on ${data!.entity.name} — profile, affiliations, recent developments`, [entityId])}
        >Research</button>
        <button
          type="button"
          onclick={() => onCommission('ask', `Tell me everything my intel graph knows about ${data!.entity.name}, and what it implies.`, [entityId])}
        >Ask jkai</button>
        <button
          type="button"
          onclick={() => onCommission('monitor', `Watch for news and changes about ${data!.entity.name}`, [entityId])}
        >Monitor</button>
        <a class="btn-link" href="/jkai/intel/entities/{entityId}">Open</a>
      </footer>
    {/if}
  {/if}
</div>

<style>
  .entity-card {
    /* Opaque — this floats over content and must never show it through. */
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    padding: 14px;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    max-width: 420px;
  }
  .entity-card.compact {
    max-width: 340px;
    padding: 12px;
    font-size: 13px;
  }

  .state {
    color: var(--text-ghost);
    font-size: var(--fs-label);
    padding: 6px 0;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 8px;
  }
  .icon {
    font-size: 18px;
    line-height: 1.2;
  }
  .head-text {
    min-width: 0;
    flex: 1;
  }
  h3 {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    font-weight: 600;
    line-height: 1.25;
    word-break: break-word;
  }
  .type {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-ghost);
  }

  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 2px 6px;
    border-radius: var(--radius-sharp);
    white-space: nowrap;
  }
  .unconfirmed {
    background: var(--warn-bg);
    color: var(--warn);
    border: 1px solid var(--warn-border);
  }

  .summary {
    margin: 0 0 10px;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    padding-bottom: 10px;
    border-bottom: 1px solid var(--divider);
    margin-bottom: 10px;
  }
  .metrics b {
    color: var(--accent-ink);
    font-weight: 600;
  }
  .broker {
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  section {
    margin-bottom: 10px;
  }
  h4 {
    margin: 0 0 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    font-weight: 500;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .neighbours {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 190px;
    overflow-y: auto;
  }
  .neighbour {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: none;
    border: none;
    padding: 3px 4px;
    border-radius: var(--radius-sharp);
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: var(--text-secondary);
  }
  .neighbour:hover {
    background: var(--accent-tint-08);
  }
  .neighbour.cross .nb-name {
    color: var(--accent);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-pill);
    flex-shrink: 0;
  }
  .nb-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rel {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    white-space: nowrap;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .props {
    margin: 0 0 10px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    font-size: var(--fs-label);
  }
  dt {
    font-family: var(--font-mono);
    color: var(--text-ghost);
    text-transform: lowercase;
  }
  dd {
    margin: 0;
    color: var(--text-secondary);
    word-break: break-word;
  }

  .timeline li {
    font-size: var(--fs-label);
    color: var(--text-secondary);
    padding: 2px 0;
  }
  .timeline time {
    font-family: var(--font-mono);
    color: var(--accent-ink);
    margin-right: 6px;
  }

  .notes li {
    font-size: var(--fs-label);
    padding: 2px 0;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .notes a {
    color: var(--accent-ink);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .notes a:hover {
    text-decoration: underline;
  }
  .src {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    flex-shrink: 0;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--divider);
  }
  footer button,
  .btn-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 4px 9px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    text-decoration: none;
    transition: background var(--t-fast) var(--ease-out);
  }
  footer button:hover,
  .btn-link:hover {
    background: var(--accent-tint-08);
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
</style>
