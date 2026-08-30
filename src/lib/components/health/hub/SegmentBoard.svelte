<script lang="ts">
  // 04 — ACHIEVEMENTS. Every metric gets its own rank.
  //
  // The fastest effort and the most efficient one are rarely the same day, so
  // one leaderboard sorted by time would hide the interesting record. Time,
  // heart rate, efficiency and beats-per-kilometre are each ranked separately
  // by `rankEfforts`, which is COMPETITION RANKING: two identical efforts are
  // both second and neither is third.
  //
  // A row with no `avgHeartrate` is one whose heart-rate window covered less
  // than half the effort. Nothing is claimed for it on any HR-derived metric
  // and the row says why, rather than quietly printing the mean of whatever
  // survived.
  import SectionHead from './SectionHead.svelte';
  import { boardNotes, boardRows } from '$lib/health/segment-detail';
  import { isPaceSport } from '$lib/trails/format';
  import type { SegmentDetail } from '$lib/trails/segments-service';

  interface Props {
    segment: SegmentDetail;
  }

  let { segment }: Props = $props();

  /** What the shortened board shows before the reader asks for the rest. */
  const PREVIEW = 8;

  let expanded = $state(false);

  const pace = $derived(isPaceSport(segment.activityType));
  const rows = $derived(boardRows(segment.efforts, pace));
  const shown = $derived(expanded ? rows : rows.slice(0, PREVIEW));
  const notes = $derived(boardNotes(segment.efforts));
</script>

{#if rows.length}
  <section class="sb">
    <div class="sb-inner">
      <SectionHead
        dark
        kicker="04 / Achievements · ranked four ways"
        title={["Fastest isn't", 'the only record']}
        strap="Every metric gets its own rank, because the fastest effort and the most efficient one are rarely the same day. Ties share a rank — two identical efforts are both second, and neither is third."
      />

      <div class="sb-scroll">
        <table class="sb-table">
          <thead>
            <tr>
              <th scope="col" class="l">#</th>
              <th scope="col" class="l">Date</th>
              <th scope="col" class="r lit">Time</th>
              <th scope="col" class="r">{pace ? 'Pace' : 'Speed'}</th>
              <th scope="col" class="r">Avg HR</th>
              <th scope="col" class="r">EF ↑</th>
              <th scope="col" class="r">b/km ↓</th>
              <th scope="col" class="l">Held ranks</th>
            </tr>
          </thead>
          <tbody>
            {#each shown as row (row.key)}
              <tr class:pb={row.isPb} class:recent={row.isLast && !row.isPb}>
                <td class="rank" class:lit={row.isPb}>
                  {row.rank == null ? '—' : String(row.rank).padStart(2, '0')}
                </td>
                <td>
                  <a class="sb-date" href="/health/activities/{encodeURIComponent(row.activityId)}"
                    >{row.dateLabel}</a
                  >
                </td>
                <td class="r time" class:lit={row.litTime}>{row.time}</td>
                <td class="r">{row.pace}</td>
                <td class="r" class:lit={row.litHr} class:void={row.unranked}>{row.avgHeartrate}</td>
                <td class="r" class:lit={row.litEf} class:void={row.unranked}>
                  {row.efficiencyFactor}
                </td>
                <td class="r" class:lit={row.litBpk} class:void={row.unranked}>{row.beatsPerKm}</td>
                <!-- Badges AND the reason. An unranked row can still be the
                     PB — nothing about the time depends on a heart rate — and
                     showing only one of the two loses whichever is rarer. -->
                <td class="held">
                  {#each row.badges as badge (badge.text)}
                    <span class="sb-badge {badge.tone}">{badge.text}</span>
                  {/each}
                  {#if row.note}
                    <span class="sb-why">{row.note}</span>
                  {:else if !row.badges.length}
                    <span class="sb-why">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if rows.length > PREVIEW}
        <button class="sb-more" type="button" onclick={() => (expanded = !expanded)}>
          {expanded
            ? `Show the quickest ${PREVIEW} ↑`
            : `Show all ${rows.length} efforts ↓`}
        </button>
      {/if}

      {#if notes.length}
        <div class="sb-notes">
          {#each notes as note (note.key)}
            <div class="sb-note" class:lead={note.lead}>
              <p class="sb-note-label">{note.label}</p>
              <p class="sb-note-text">{note.text}</p>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .sb {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(40px, 5vw, 68px) clamp(20px, 3vw, 44px);
  }
  .sb-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  /* A wide table scrolls rather than reflowing — a numeric column that wraps
     is a column nobody can compare down. */
  .sb-scroll {
    overflow-x: auto;
  }
  .sb-table {
    width: 100%;
    min-width: 860px;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .sb-table thead tr {
    border-bottom: 1px solid rgba(237, 228, 212, 0.3);
  }
  .sb-table th {
    padding: 0 12px 12px 0;
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
  }
  .sb-table th.lit {
    color: var(--accent-on-dark);
  }
  .sb-table th.l {
    text-align: left;
  }
  .sb-table th.r {
    text-align: right;
  }
  .sb-table th:last-child,
  .sb-table td:last-child {
    padding-right: 0;
  }

  .sb-table tbody tr {
    border-bottom: 1px solid rgba(237, 228, 212, 0.12);
    transition: background 0.2s ease-out;
  }
  .sb-table tbody tr.pb {
    background: rgba(232, 134, 58, 0.11);
  }
  .sb-table tbody tr.recent {
    background: rgba(237, 228, 212, 0.05);
  }
  .sb-table tbody tr:hover {
    background: rgba(237, 228, 212, 0.08);
  }

  .sb-table td {
    padding: 12px 12px 12px 0;
    color: rgba(237, 228, 212, 0.8);
    white-space: nowrap;
  }
  .sb-table td.r {
    text-align: right;
  }
  .sb-table td.rank {
    color: rgba(237, 228, 212, 0.55);
  }
  .sb-table td.time {
    font-weight: 500;
  }
  .sb-table td.lit {
    font-weight: 700;
    color: var(--accent-on-dark);
  }
  .sb-table td.void {
    color: rgba(237, 228, 212, 0.35);
  }

  .sb-date {
    color: rgba(237, 228, 212, 0.8);
    text-decoration: none;
    transition: color 0.2s ease-out;
  }
  .sb-date:hover {
    color: var(--accent-on-dark);
  }

  .held {
    white-space: normal;
  }
  .sb-badge {
    display: inline-block;
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border-radius: 0;
    padding: 3px 7px;
    margin-right: 6px;
  }
  .sb-badge.solid {
    background: var(--accent-on-dark);
    color: var(--text-primary);
  }
  .sb-badge.outline {
    border: 1px solid rgba(232, 134, 58, 0.5);
    color: var(--accent-on-dark);
  }
  .sb-badge.cream {
    border: 1px solid rgba(237, 228, 212, 0.4);
    color: rgba(237, 228, 212, 0.85);
  }
  .sb-badge.plain {
    padding: 3px 0;
    font-weight: 400;
    color: rgba(237, 228, 212, 0.55);
  }
  .sb-why {
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
  }

  .sb-more {
    display: inline-block;
    margin-top: 18px;
    padding: 8px 16px;
    background: transparent;
    border: 1px solid rgba(237, 228, 212, 0.3);
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.8);
    cursor: pointer;
    /* Hover is colour only. */
    transition:
      color 0.2s ease-out,
      border-color 0.2s ease-out;
  }
  .sb-more:hover {
    color: var(--accent-on-dark);
    border-color: rgba(232, 134, 58, 0.5);
  }

  .sb-notes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
    margin-top: 26px;
  }
  .sb-note {
    border-left: 3px solid rgba(237, 228, 212, 0.3);
    padding-left: 16px;
    min-width: 0;
  }
  .sb-note.lead {
    border-left-color: var(--accent-on-dark);
  }
  .sb-note-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.5);
    margin: 0 0 8px;
  }
  .sb-note.lead .sb-note-label {
    color: var(--accent-on-dark);
  }
  .sb-note-text {
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.7);
    text-wrap: pretty;
    margin: 0;
  }
  .sb-note.lead .sb-note-text {
    color: rgba(237, 228, 212, 0.8);
  }
</style>
