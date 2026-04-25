<script lang="ts">
  let { timeline, onselect }: { timeline: any; onselect?: (event: any) => void } = $props();

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function handleClick(event: any) {
    if (event.type === 'strava_activity' && onselect) {
      const id = event.id.replace('strava-', '');
      onselect({ ...event, stravaId: id });
    }
  }

  function typeLabel(t: string): string {
    return t === 'strava_activity' ? 'activity' :
           t === 'whoop_workout' ? 'workout' :
           t === 'whoop_sleep' ? 'sleep' :
           t === 'whoop_recovery' ? 'recovery' : t;
  }
</script>

{#if timeline?.events?.length}
  {#each timeline.events as event}
    {@const clickable = event.type === 'strava_activity'}
    <div
      class="row"
      class:disabled={!clickable}
      role={clickable ? 'button' : undefined}
      tabindex={clickable ? 0 : undefined}
      onclick={() => handleClick(event)}
      onkeydown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleClick(event); } }}
    >
      <div class="meta">
        <span class="kind">{typeLabel(event.type)}</span>
        <span class="title">{event.title}</span>
      </div>
      <div class="summary">
        {#each Object.entries(event.summary) as [key, value], i}
          {#if i < 3}
            <span class="kv"><span class="k">{key}</span> <span class="v">{value as string}</span></span>
          {/if}
        {/each}
      </div>
      <div class="date">{formatDate(event.date)}</div>
      <span class="arrow">{clickable ? '›' : ''}</span>
    </div>
  {/each}
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.4fr) minmax(110px, auto) auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.55rem 0.6rem 0.55rem 0.4rem;
    border-bottom: 1px solid var(--divider);
    transition: background 80ms ease;
  }
  .row:last-child { border-bottom: 0; }
  .row:not(.disabled) { cursor: pointer; }
  .row:not(.disabled):hover { background: var(--surface-overlay); }
  .row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; background: var(--surface-overlay); }
  .meta { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; }
  .kind {
    font-family: var(--font-mono); font-size: 9px; text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--text-ghost); flex-shrink: 0;
  }
  .title {
    font-family: var(--font-mono); font-size: 11px; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
  }
  .summary {
    display: flex; flex-wrap: wrap; gap: 0.6rem;
    font-family: var(--font-mono); font-size: 10px;
    color: var(--text-muted);
    overflow: hidden; min-width: 0;
  }
  .kv .k { color: var(--text-ghost); }
  .kv .v { color: var(--text-secondary); }
  .date { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); white-space: nowrap; text-align: right; }
  .arrow { font-family: var(--font-mono); font-size: 14px; color: var(--text-ghost); line-height: 1; }
  .row:not(.disabled):hover .arrow { color: var(--accent); }
  @media (max-width: 640px) {
    .row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 4px; }
    .summary { grid-column: 1 / -1; }
    .date { grid-column: 1 / 2; }
    .arrow { grid-row: 1; grid-column: 2; }
  }
</style>
