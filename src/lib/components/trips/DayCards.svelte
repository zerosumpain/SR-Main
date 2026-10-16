<script lang="ts">
  /**
   * The Overview's days as index cards pinned to the page: the day's number
   * and weekday, then its four stages in brief, each marked with that
   * stage's pencil (morning petrol, lunch orange, afternoon ochre, evening
   * ink — the same pencils as the stage bands, and always with the stage's
   * name beside them). A card opens that day's tab.
   */
  import { DAY_STAGES, DAY_STAGE_LABEL, type PlannedDay } from '$lib/trips/model';
  import { dayBrief } from '$lib/trips/stages';
  import { stampDate, weekday } from './notes/notes';

  let { days, loadOf, onOpen }: { days: PlannedDay[]; loadOf: (date: string) => string; onOpen: (date: string) => void } = $props();

  const TILTS = [-0.8, 0.6, -0.4, 0.9, -0.6, 0.5];
</script>

<ol class="day-cards">
  {#each days as d, di (d.date)}
    {@const brief = dayBrief(d)}
    <li>
      <button class="day-card np-card" style:--np-tilt="{TILTS[di % TILTS.length]}deg" type="button" onclick={() => onOpen(d.date)} aria-label="Open day {di + 1}, {weekday(d.date)} {stampDate(d.date)}">
        <span class="dc-hd">
          <span class="dc-num">{di + 1}</span>
          <span class="dc-day">{weekday(d.date)}</span>
          <span class="dc-date">{stampDate(d.date)}</span>
          {#if loadOf(d.date) !== 'normal'}<span class="dc-load">{loadOf(d.date)} day</span>{/if}
        </span>
        {#each DAY_STAGES as st (st)}
          <span class="dc-stage" data-stage={st}>
            <span class="dcs-label"><span class="dcs-dot" aria-hidden="true"></span>{DAY_STAGE_LABEL[st]}</span>
            <span class="dcs-what" class:free={!brief[st].length}>{brief[st].join(' · ') || 'free'}</span>
          </span>
        {/each}
        <span class="dc-open" aria-hidden="true">Open the day →</span>
      </button>
    </li>
  {/each}
</ol>

<style>
  .day-cards {
    list-style: none;
    margin: 0;
    padding: 6px 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 22px 20px;
  }
  .day-card {
    display: grid;
    align-content: start;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: transform 160ms ease;
  }
  .day-card:hover,
  .day-card:focus-visible {
    transform: rotate(0deg) translateY(-2px);
    border-color: var(--accent-ink);
  }
  .day-card:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 3px;
  }
  /* The head sits above the card's red rule (44px down). */
  .dc-hd {
    display: flex;
    align-items: baseline;
    gap: 8px;
    height: 30px;
    margin-bottom: 4px;
  }
  .dc-num {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 28px;
    line-height: 1;
    color: var(--accent);
  }
  .dc-day {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
    letter-spacing: -0.01em;
  }
  .dc-date {
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--np-ink-soft, var(--text-secondary));
  }
  .dc-load {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .dc-stage {
    --pencil: var(--accent-ink);
    display: grid;
    grid-template-columns: 9.6rem minmax(0, 1fr);
    gap: 8px;
    font-size: var(--fs-label);
    line-height: 24px;
  }
  .dc-stage[data-stage='lunch'] {
    --pencil: var(--accent);
  }
  .dc-stage[data-stage='afternoon'] {
    --pencil: #8c6a12;
  }
  .dc-stage[data-stage='evening'] {
    --pencil: var(--text-primary);
  }
  .dcs-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--np-ink-soft, var(--text-secondary));
    white-space: nowrap;
  }
  .dcs-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 100px;
    background: var(--pencil);
  }
  .dcs-what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dcs-what.free {
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--text-muted);
  }
  .dc-open {
    margin-top: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 24px;
    color: var(--accent-ink);
  }
  @media (prefers-reduced-motion: reduce) {
    .day-card {
      transition: none;
    }
  }
  @media (max-width: 640px) {
    .dc-stage {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
      line-height: 22px;
      padding-bottom: 2px;
    }
  }
</style>
