<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  function stamp(value: Date | string | null): string {
    if (!value) return 'Unknown';
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long' }).format(new Date(value));
  }

  function entries(value: unknown): Array<[string, unknown]> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : [];
  }

  function shown(value: unknown): string {
    if (value === null) return 'Unknown';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
</script>

<svelte:head><title>Activity evidence — JKAI</title></svelte:head>

<main class="event-shell">
  <a class="back" href="/jkai/activity">← Activity</a>
  <header>
    <p class="eyebrow">{data.event.type.replaceAll('.', ' · ')}</p>
    <h1>{shown((data.event.object as Record<string, unknown>).label ?? (data.event.object as Record<string, unknown>).kind)}</h1>
    <p>{data.connection.label} · {data.event.source}</p>
  </header>

  <section class="time-grid">
    <div><span>Occurred</span><strong>{stamp(data.event.occurredAt)}</strong><small>{data.event.occurredAt ? 'Supplied by the evidence source.' : 'The source did not provide an occurrence time.'}</small></div>
    <div><span>Observed</span><strong>{stamp(data.event.observedAt)}</strong><small>When JKAI received or observed this record.</small></div>
    <div><span>Evidence</span><strong>{data.event.evidenceMode.replaceAll('_', ' ')}</strong><small>This quality follows the event into every projection.</small></div>
  </section>

  <section>
    <p class="section-code">A / Object</p>
    <dl>{#each entries(data.event.object) as [key, value]}<div><dt>{key}</dt><dd>{shown(value)}</dd></div>{/each}</dl>
  </section>
  <section>
    <p class="section-code">B / Measures</p>
    {#if entries(data.event.measures).length}<dl>{#each entries(data.event.measures) as [key, value]}<div><dt>{key}</dt><dd>{shown(value)}</dd></div>{/each}</dl>{:else}<p class="empty">No measures on this event.</p>{/if}
  </section>
  <section>
    <p class="section-code">C / Provenance</p>
    <dl>{#each entries(data.event.provenance) as [key, value]}<div><dt>{key}</dt><dd>{shown(value)}</dd></div>{/each}</dl>
    <p class="fine">The normalized event contains metadata only. Raw provider content, when present, is held separately and needs an independent grant.</p>
  </section>
</main>

<style>
  .event-shell { width: min(820px, calc(100% - 32px)); margin: 0 auto; padding: 38px 0 80px; color: var(--text-primary); }
  .back { display: inline-block; margin-bottom: 34px; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label); text-decoration: none; }
  header { padding-bottom: 26px; border-bottom: 2px solid var(--line-strong); }
  .eyebrow, .section-code { margin: 0 0 8px; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 0; font-family: var(--font-display); font-size: clamp(34px, 7vw, 60px); font-weight: 500; line-height: 1; overflow-wrap: anywhere; }
  header p:last-child { margin: 10px 0 0; color: var(--text-muted); }
  .time-grid { display: grid; grid-template-columns: repeat(3, 1fr); padding: 0; border-left: 1px solid var(--line-strong); }
  .time-grid div { display: grid; align-content: start; gap: 6px; padding: 14px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .time-grid span, dt { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .time-grid strong { font-size: var(--fs-label); line-height: 1.4; }
  .time-grid small { color: var(--text-ghost); font-size: var(--fs-label-xs); line-height: 1.4; }
  section:not(.time-grid) { padding: 28px 0; border-bottom: 1px solid var(--line-strong); }
  dl { margin: 0; border-top: 1px solid var(--line-strong); }
  dl div { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 18px; padding: 10px 0; border-bottom: 1px solid var(--line-strong); }
  dd { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label); overflow-wrap: anywhere; }
  .empty, .fine { margin: 0; color: var(--text-muted); font-size: var(--fs-label); }
  .fine { margin-top: 13px; line-height: 1.5; }
  @media (max-width: 650px) {
    .event-shell { width: min(100% - 20px, 820px); }
    .time-grid { grid-template-columns: 1fr; }
    dl div { grid-template-columns: 1fr; gap: 4px; }
  }
</style>
