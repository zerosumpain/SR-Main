<script lang="ts">
  /**
   * The Overview's day cards: each day's four stages in brief, in the same
   * treatments as the stage bands (morning petrol, lunch orange wash,
   * afternoon hatch, evening ink). A card opens that day's tab.
   */
  import { dayLabel } from '$lib/trips/changes';
  import { DAY_STAGES, DAY_STAGE_LABEL, type PlannedDay } from '$lib/trips/model';
  import { dayBrief } from '$lib/trips/stages';

  let { days, loadOf, onOpen }: { days: PlannedDay[]; loadOf: (date: string) => string; onOpen: (date: string) => void } = $props();
</script>

<ol class="day-cards">
  {#each days as d, di (d.date)}
    {@const brief = dayBrief(d)}
    <li>
      <button class="day-card" type="button" onclick={() => onOpen(d.date)} aria-label="Open {dayLabel(d.date)}">
        <span class="dc-hd"><span class="dc-num">{di + 1}</span><span class="dc-date">{dayLabel(d.date)}</span>{#if loadOf(d.date) !== 'normal'}<span class="tab-load">{loadOf(d.date)}</span>{/if}</span>
        {#each DAY_STAGES as st (st)}
          <span class="dc-stage dcs-{st}"><span class="dcs-label">{DAY_STAGE_LABEL[st]}</span><span class="dcs-what">{brief[st].join(' · ') || 'free'}</span></span>
        {/each}
      </button>
    </li>
  {/each}
</ol>

<style>
  .day-cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .day-card {
    display: grid;
    gap: 3px;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
    font: inherit;
  }
  .day-card:hover,
  .day-card:focus-visible {
    border-color: var(--accent-ink);
    outline: none;
  }
  .dc-hd {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
  }
  .dc-num {
    font-family: var(--font-display);
    font-size: 1.4rem;
    color: var(--accent);
  }
  .dc-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .dc-stage {
    display: grid;
    grid-template-columns: 9.5rem minmax(0, 1fr);
    gap: 8px;
    padding: 3px 8px;
    font-size: var(--fs-label);
    border-radius: 2px;
  }
  .dcs-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .dcs-what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dcs-morning {
    background: var(--accent-ink-tint-06);
    color: var(--accent-ink);
  }
  .dcs-lunch {
    background: var(--accent-tint-08);
  }
  .dcs-afternoon {
    background-color: var(--surface-rail);
    background-image: repeating-linear-gradient(135deg, var(--surface-overlay) 0 2px, transparent 2px 9px);
  }
  .dcs-evening {
    background: var(--chrome-bg);
    color: var(--chrome-ink);
  }
  .tab-load {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    border: 1px solid var(--accent-ink);
    color: var(--accent-ink);
    border-radius: 100px;
    padding: 0 6px;
  }
  @media (max-width: 640px) {
    .dc-stage {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
  }
</style>
