<script lang="ts">
  import EvidenceSort from '$lib/components/activity/EvidenceSort.svelte';
  import '$lib/styles/sources.css';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const evidenceLabels: Record<string, string> = {
    provider_event: 'Provider event',
    provider_snapshot: 'Snapshot',
    inferred_delta: 'Inferred',
    archive_import: 'Archive',
    device_observation: 'Device',
  };

  function stamp(value: Date | string): string {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }

  function label(event: PageData['events'][number]): string {
    const object = event.object as { label?: unknown; kind?: unknown };
    if (typeof object.label === 'string' && object.label) return object.label;
    if (typeof object.kind === 'string' && object.kind) return object.kind.replaceAll('_', ' ');
    return event.type.replaceAll('.', ' ');
  }

  function connectionLabel(id: string): string {
    return data.connections.find((connection) => connection.id === id)?.label ?? 'Unknown source';
  }

  function filterHref(key: 'evidence' | 'connection', value: string | null): string {
    const params = new URLSearchParams({ sort: data.ordering.sort, direction: data.ordering.direction });
    if (data.ordering.then) params.set('then', data.ordering.then);
    const evidence = key === 'evidence' ? value : data.filters.evidence;
    const connection = key === 'connection' ? value : data.filters.connection;
    if (evidence) params.set('evidence', evidence);
    if (connection) params.set('connection', connection);
    const query = params.toString();
    return `/jkai/activity${query ? `?${query}` : ''}`;
  }
</script>

<svelte:head><title>Activity — JKAI</title></svelte:head>

<main class="activity-shell source-surface">
  <header class="activity-head">
    <p class="eyebrow">JKAI · Evidence audit</p>
    <div class="title-row">
      <div>
        <h1>Activity</h1>
        <p>What connected sources actually supplied, including uncertainty and provenance.</p>
      </div>
      <a href="/jkai/sources">Manage sources →</a>
    </div>
  </header>

  <section class="filters" aria-label="Activity filters">
    <div>
      <span>Evidence</span>
      <a aria-current={!data.filters.evidence ? 'true' : undefined} class:active={!data.filters.evidence} href={filterHref('evidence', null)}>All</a>
      {#each Object.entries(evidenceLabels) as [value, text] (value)}
        <a aria-current={data.filters.evidence === value ? 'true' : undefined} class:active={data.filters.evidence === value} href={filterHref('evidence', value)}>{text}</a>
      {/each}
    </div>
    {#if data.connections.length > 0}
      <div>
        <span>Source</span>
        <a aria-current={!data.filters.connection ? 'true' : undefined} class:active={!data.filters.connection} href={filterHref('connection', null)}>All</a>
        {#each data.connections as connection (connection.id)}
          <a aria-current={data.filters.connection === connection.id ? 'true' : undefined} class:active={data.filters.connection === connection.id} href={filterHref('connection', connection.id)}>{connection.label}</a>
        {/each}
      </div>
    {/if}
  </section>

  <EvidenceSort ordering={data.ordering} preserve={data.filters} />

  <section class="ledger" aria-labelledby="ledger-title">
    <div class="ledger-head">
      <div>
        <p class="section-code">A / Ledger</p>
        <h2 id="ledger-title">{data.events.length} current record{data.events.length === 1 ? '' : 's'}</h2>
      </div>
      <p>Showing up to 100 matching records.</p>
    </div>

    {#if data.events.length === 0}
      <div class="empty">
        <p>No evidence matches this view.</p>
        <span>{data.connections.length === 0 ? 'Connect or import a source to begin the ledger.' : 'Try another evidence or source filter.'}</span>
      </div>
    {:else}
      <ol class="event-list">
        {#each data.events as event (event.id)}
          <li>
            <a href="/jkai/activity/{event.id}">
              <span class="event-time">
                <small>Occurred</small>
                <strong>{event.occurredAt ? stamp(event.occurredAt) : 'Unknown'}</strong>
                <small>Observed</small>
                <strong>{stamp(event.observedAt)}</strong>
              </span>
              <span class="event-main">
                <strong>{label(event)}</strong>
                <small>{event.type.replaceAll('.', ' ')} · {connectionLabel(event.connectionId)}</small>
              </span>
              <span class="evidence evidence-{event.evidenceMode}">{evidenceLabels[event.evidenceMode] ?? event.evidenceMode}</span>
              <span aria-hidden="true">→</span>
            </a>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</main>

<style>
  .activity-head { padding-bottom: 28px; border-bottom: 2px solid var(--line-title); }
  .eyebrow, .section-code { margin: 0 0 8px; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent, #c4570a); }
  .title-row { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
  .title-row p { max-width: 680px; margin: 14px 0 0; color: var(--text-muted); font-size: var(--fs-body); }
  .title-row a { color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label); text-decoration: none; white-space: nowrap; }
  .filters { display: grid; gap: 10px; padding: 18px 0; border-bottom: 1px solid var(--line-strong); }
  .filters div { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .filters span { width: 76px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-ghost); }
  .filters a { padding: 3px 7px; border: 1px solid var(--line-strong); color: var(--text-muted); font-size: var(--fs-label-xs); text-decoration: none; }
  .filters a.active { border-color: var(--accent, #c4570a); color: var(--accent, #c4570a); }
  .ledger { padding-top: 34px; }
  .ledger-head { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
  .ledger-head h2 { margin: 0; font-family: var(--font-display); font-size: clamp(1.375rem, 2.5vw, 2rem); font-weight: 500; }
  .ledger-head > p { margin: 0; color: var(--text-ghost); font-size: var(--fs-label-xs); }
  .empty { padding: 22px; border: 1px dashed var(--line-strong); }
  .empty p { margin: 0 0 6px; }
  .empty span { color: var(--text-muted); font-size: var(--fs-label); }
  .event-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line-strong); }
  .event-list a { display: grid; grid-template-columns: 190px minmax(0, 1fr) auto 18px; gap: 18px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line-strong); color: inherit; text-decoration: none; }
  .event-list a:hover .event-main > strong { color: var(--accent, #c4570a); }
  .event-time, .event-main { display: grid; gap: 3px; min-width: 0; }
  .event-time strong { font-family: var(--font-mono); font-size: var(--fs-label); font-weight: 500; }
  .event-time small, .event-main small { color: var(--text-ghost); font-size: var(--fs-label-xs); }
  .event-main > strong { overflow-wrap: anywhere; font-size: var(--fs-body); }
  .evidence { padding: 3px 6px; border: 1px solid currentColor; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-muted); }
  .evidence-provider_event, .evidence-device_observation { color: var(--success, #2d7a3a); }
  .evidence-inferred_delta { color: var(--warn, #b0892a); }
  .evidence-provider_snapshot { color: var(--accent, #c4570a); }
  @media (max-width: 700px) {
      .title-row, .ledger-head { align-items: flex-start; flex-direction: column; }
    .event-list a { grid-template-columns: 1fr auto; gap: 8px 12px; }
    .event-time, .event-main { grid-column: 1; }
    .evidence { grid-column: 2; grid-row: 1; }
    .event-list a > span:last-child { display: none; }
  }
</style>
