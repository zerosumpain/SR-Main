<script lang="ts">
  /**
   * One stage of a day in the trip studio (v4): breakfast & morning, lunch,
   * afternoon, or dinner & evening. Each stage wears its own treatment so a
   * day reads at a glance — morning is paper with a petrol dot grain, lunch an
   * orange wash, afternoon a hatched rail, evening the ink ground the site's
   * bar uses. All from the design tokens; none of the reserved categorical
   * hues. Stops show their times, the leg that brings you there (with its
   * guidance) and, for wishes, quick edits; "Ask about this stage" pre-fills
   * the conversation.
   */
  import { DAY_STAGE_LABEL, type DayStage, type TravelMode, type Wish } from '$lib/trips/model';
  import type { StageItem } from '$lib/trips/stages';
  import IdeaTray from './IdeaTray.svelte';

  let {
    stage,
    items,
    dayName,
    wishes,
    dates,
    highlight,
    live = {},
    date,
    busy = false,
    onAsk,
    onPatch,
    dateLabel,
    base,
    dayStopIds = [],
    onAdded = async () => {},
  }: {
    stage: DayStage;
    items: StageItem[];
    dayName: string;
    wishes: Wish[];
    dates: string[];
    highlight: Set<string>;
    live?: Record<string, number | null>;
    date: string;
    busy?: boolean;
    onAsk: (text: string) => void;
    onPatch: (w: Wish, patch: Record<string, unknown>, done?: string) => void;
    dateLabel: (d: string) => string;
    /** The trip's API base, for the idea tray. */
    base: string;
    /** Every stop id of the day in order, so a gap can name the stops either side. */
    dayStopIds?: string[];
    /** After an idea is added: reload, and highlight what moved. */
    onAdded?: () => Promise<void>;
  } = $props();

  /** Stops whose quick edits (day, lock, must/nice) are open. Closed by default, so the day reads as a plan. */
  let adjusting = $state<Set<string>>(new Set());
  function toggleAdjust(id: string) {
    const next = new Set(adjusting);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    adjusting = next;
  }

  /** The open idea tray: the whole stage, or the gap between two stops. */
  let tray = $state<{ afterStopId: string | null; beforeStopId: string | null } | null>(null);
  const around = (id: string) => {
    const i = dayStopIds.indexOf(id);
    return { afterStopId: i > 0 ? dayStopIds[i - 1] : null, beforeStopId: i >= 0 && i + 1 < dayStopIds.length ? dayStopIds[i + 1] : null };
  };
  /** Free time at the stay mid-day, or a long wait before a stop, is a gap worth filling. */
  const isGap = (item: StageItem) =>
    (item.stop.kind === 'stay' && item.index > 0 && item.index < dayStopIds.length - 1 && item.stop.departMin - item.stop.arriveMin >= 45) ||
    (item.stop.kind !== 'stay' && item.stop.waitSec >= 45 * 60);

  const MODE: Record<TravelMode, string> = { walk: 'Walk', cycle: 'Cycle', drive: 'Drive', transit: 'Public transport', taxi: 'Taxi' };
  const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
  const visible = $derived(items);
  const span = $derived.by(() => {
    const real = items.filter((i) => i.stop.kind !== 'stay');
    if (!real.length) return null;
    return `${hhmm(real[0].stop.arriveMin)}–${hhmm(real[real.length - 1].stop.departMin)}`;
  });
  const wishOf = (id: string | null) => (id ? wishes.find((w) => w.id === id) : undefined);
  const waitText = (sec: number) => {
    const m = Math.round(sec / 60);
    return m > 45 ? `free time ${m} min` : `wait ${m} min`;
  };
  const ASK: Record<DayStage, string> = {
    morning: 'breakfast and the morning',
    lunch: 'lunch',
    afternoon: 'the afternoon',
    evening: 'dinner and the evening',
  };
</script>

<section class="band band-{stage}" aria-label="{DAY_STAGE_LABEL[stage]}, {dayName}">
  <header class="band-hd">
    <span class="dot" aria-hidden="true"></span>
    <h3>{DAY_STAGE_LABEL[stage]}</h3>
    {#if span}<span class="span mono">{span}</span>{/if}
    <span class="hd-acts">
      {#if !tray}<button class="pen" type="button" onclick={() => (tray = { afterStopId: null, beforeStopId: null })}>Find an idea</button>{/if}
      <button class="pen" type="button" disabled={busy} onclick={() => onAsk(`For ${dayName}, ${ASK[stage]}: `)}>Ask the planner</button>
    </span>
  </header>

  {#if !items.some((i) => i.stop.kind !== 'stay' || i.stop.id.endsWith(':rest'))}
    <p class="free">Free — nothing planned yet.</p>
  {/if}
  {#if tray}
    <IdeaTray {base} {date} {stage} {dayName} afterStopId={tray.afterStopId} beforeStopId={tray.beforeStopId} {onAdded} onClose={() => (tray = null)} />
  {/if}

  <ol class="stops">
    {#each visible as item (item.stop.id)}
      {@const s = item.stop}
      {@const leg = item.legIn}
      {#if leg && leg.durationSec >= 60}
        {@const liveMin = live[`${date}|${leg.fromStopId}|${leg.toStopId}`]}
        <li class="leg">
          <span class="leg-line" aria-hidden="true"></span>
          <span class="leg-body">
            <span class="mono">{MODE[leg.mode]} {Math.round(leg.durationSec / 60)} min{leg.estimated ? ' · est.' : ''}{liveMin !== undefined && liveMin !== null ? ` · live ${liveMin} min` : ''}</span>
            {#if leg.guidance}
              {@const g = leg.guidance}
              <details class="guide">
                <summary>{g.summary}</summary>
                {#if g.transit?.length}
                  <ul>
                    {#each g.transit as t, ti (ti)}
                      <li>{t.vehicle} {t.line}: {t.fromStop} → {t.toStop}{t.stops ? ` (${t.stops} stops)` : ''}{t.departuresMin.length ? ` · leaves ${t.departuresMin.map(hhmm).join(', ')}` : ''}</li>
                    {/each}
                  </ul>
                {/if}
                {#if g.steps.length}<ol class="steps">{#each g.steps as st, sti (sti)}<li>{st}</li>{/each}</ol>{/if}
                {#if g.booking}
                  <p>{g.booking.how}</p>
                  {#if g.booking.links.length}<p>{#each g.booking.links as l, li (l.url)}{li ? ' · ' : ''}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>{/each}</p>{/if}
                {/if}
                {#if g.tips.length}<ul>{#each g.tips as t, ti (ti)}<li>{t}</li>{/each}</ul>{/if}
              </details>
            {/if}
          </span>
        </li>
      {/if}
      <li class="stop kind-{s.kind}" class:changed={highlight.has(s.id)}>
        <span class="time mono">{hhmm(s.arriveMin)}{#if s.departMin !== s.arriveMin}<span class="t-to">–{hhmm(s.departMin)}</span>{/if}</span>
        <span class="body">
          {#if s.kind === 'transport'}<span class="tag mono">{s.id.endsWith(':arrive') ? 'Arrive' : 'Leave'}</span>{:else if s.kind === 'meal'}<span class="tag mono">Meal</span>{/if}
          <strong class="title">{s.title}</strong>
          {#if s.bookingId}<span class="tag mono">booked</span>{/if}
          {#if s.waitSec >= 60}<span class="note"> · {waitText(s.waitSec)}</span>{/if}
          {#if isGap(item) && !tray}
            <button class="link gap" type="button" onclick={() => (tray = s.kind === 'stay' ? around(s.id) : { afterStopId: around(s.id).afterStopId, beforeStopId: s.id })}>Ideas for this gap</button>
          {/if}
          {#each s.warnings as wn, wi (wi)}<span class="warn">{wn}</span>{/each}
          {#if s.kind === 'wish' && s.wishId}
            {@const w = wishOf(s.wishId)}
            {#if w}
              {#if w.locked || w.priority === 'must'}<span class="marks">{#if w.priority === 'must'}<span class="tag mono">must</span>{/if}{#if w.locked}<span class="tag mono">locked</span>{/if}</span>{/if}
              <button class="adjust" type="button" aria-expanded={adjusting.has(s.id)} onclick={() => toggleAdjust(s.id)}>{adjusting.has(s.id) ? 'Done' : 'Adjust'}</button>
              {#if adjusting.has(s.id)}
                <span class="edits">
                  <label>Day
                    <select aria-label="Move {s.title} to another day" value={w.fixedDate ?? ''} disabled={busy} onchange={(e) => onPatch(w, { fixedDate: e.currentTarget.value || null }, 'Moved.')}>
                      <option value="">any day</option>
                      {#each dates as d (d)}<option value={d}>{dateLabel(d)}</option>{/each}
                    </select>
                  </label>
                  <button type="button" disabled={busy} aria-pressed={w.locked} onclick={() => onPatch(w, { locked: !w.locked }, w.locked ? 'Unlocked.' : 'Locked to this day and time.')}>{w.locked ? 'Unlock' : 'Lock day and time'}</button>
                  <button type="button" disabled={busy} onclick={() => onPatch(w, { priority: w.priority === 'must' ? 'nice' : 'must' })}>{w.priority === 'must' ? 'Make it a nice-to-have' : 'Make it a must'}</button>
                </span>
              {/if}
              {#if w.guide}
                <details class="guide">
                  <summary>When you get there</summary>
                  <p>{w.guide.summary}</p>
                  {#if w.guide.tips.length}<ul>{#each w.guide.tips as t, ti (ti)}<li>{t}</li>{/each}</ul>{/if}
                  {#if w.guide.links.length}<p>{#each w.guide.links as l, li (l.url)}{li ? ' · ' : ''}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>{/each}</p>{/if}
                </details>
              {/if}
            {/if}
          {/if}
        </span>
      </li>
    {/each}
  </ol>
</section>

<style>
  /* Each stage is a different kind of paper on the same sheet, marked with
     its own pencil (the same pencils as the overview's day cards):
     breakfast & morning on a ruled index card (petrol), lunch on a sticky
     note (orange), the afternoon on graph paper (ochre), dinner & evening on
     the cover's ink. The stage's name always says which it is. */
  .band {
    --band-ink: var(--text-primary);
    --band-soft: var(--text-secondary);
    --band-rule: var(--line-strong);
    --band-link: var(--accent-ink);
    --pencil: var(--accent-ink);
    position: relative;
    padding: 14px 18px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    color: var(--band-ink);
  }
  .band-morning {
    background-color: var(--np-card, var(--surface-card));
    background-image: repeating-linear-gradient(to bottom, transparent 0 31px, var(--np-rule, rgba(14, 91, 102, 0.16)) 31px 32px);
    box-shadow: inset 4px 0 0 var(--pencil);
  }
  .band-lunch {
    --pencil: var(--accent);
    --band-ink: #1a1008;
    --band-soft: #5a4632;
    --band-rule: rgba(26, 16, 8, 0.25);
    --band-link: #8a3c06;
    background: linear-gradient(160deg, #f7d9b4, #f2c99a);
    border-color: transparent;
    box-shadow: 0 10px 20px -16px rgba(26, 16, 8, 0.45);
  }
  .band-afternoon {
    --pencil: #8c6a12;
    background-color: var(--np-card, var(--surface-card));
    background-image:
      linear-gradient(var(--np-graph-major, rgba(14, 91, 102, 0.14)) 1px, transparent 1px),
      linear-gradient(90deg, var(--np-graph-major, rgba(14, 91, 102, 0.14)) 1px, transparent 1px),
      linear-gradient(var(--np-graph-minor, rgba(14, 91, 102, 0.06)) 1px, transparent 1px),
      linear-gradient(90deg, var(--np-graph-minor, rgba(14, 91, 102, 0.06)) 1px, transparent 1px);
    background-size:
      80px 80px,
      80px 80px,
      16px 16px,
      16px 16px;
    border-color: rgba(14, 91, 102, 0.3);
  }
  .band-evening {
    --pencil: var(--accent-on-dark);
    --band-ink: var(--bg);
    --band-soft: var(--on-ink-70);
    --band-rule: var(--on-ink-30);
    --band-link: var(--accent-on-dark);
    background-color: var(--text-primary);
    background-image: repeating-linear-gradient(to bottom, transparent 0 31px, var(--on-ink-05) 31px 32px);
    border-color: var(--text-primary);
  }
  :global(html[data-reading-theme='night']) .band-evening,
  :global(html[data-theme='dark']) .band-evening {
    --band-ink: var(--chrome-ink);
    background-color: var(--chrome-bg);
  }
  .band-hd {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-bottom: 6px;
  }
  .dot {
    align-self: center;
    width: 10px;
    height: 10px;
    border-radius: 100px;
    background: var(--pencil);
  }
  .band-hd h3 {
    margin: 0;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
    font-weight: 400;
    font-size: 24px;
    line-height: 32px;
    color: var(--band-ink);
  }
  .span {
    font-size: var(--fs-label-xs);
    color: var(--band-soft);
  }
  .hd-acts {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-left: auto;
  }
  .pen {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    padding: 3px 10px;
    border: 1px dashed var(--band-rule);
    border-radius: 100px;
    background: transparent;
    color: var(--band-link);
    cursor: pointer;
  }
  .pen:hover:not(:disabled),
  .pen:focus-visible {
    border-style: solid;
    border-color: var(--band-link);
    outline: none;
  }
  .pen:disabled {
    opacity: 0.5;
  }
  .free {
    margin: 0 0 4px;
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--band-soft);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--band-link);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .gap {
    display: inline-block;
    margin-left: 8px;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-label);
  }
  .stops {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .stop {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 10px;
    padding: 4px 4px;
    line-height: 24px;
    border-radius: 2px;
  }
  .stop.changed {
    animation: changed 3.5s ease-out;
  }
  @keyframes changed {
    0%,
    40% {
      background: var(--accent-tint-25);
      outline: 2px solid var(--accent);
    }
    100% {
      background: transparent;
      outline: 2px solid transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stop.changed {
      animation: none;
      outline: 2px solid var(--accent);
    }
  }
  .time {
    font-size: var(--fs-label);
    color: var(--band-soft);
    font-variant-numeric: tabular-nums;
  }
  .title {
    font-weight: 600;
  }
  .kind-stay .title,
  .kind-meal .title {
    font-weight: 400;
  }
  .kind-stay .title {
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--band-soft);
  }
  .kind-transport .title {
    color: var(--band-link);
  }
  .tag {
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border: 1px solid var(--band-rule);
    border-radius: 100px;
    padding: 0 7px;
    margin-right: 6px;
    color: var(--band-soft);
  }
  .marks {
    margin-left: 8px;
  }
  .note {
    color: var(--band-soft);
    font-size: var(--fs-label);
  }
  .warn {
    display: block;
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--warn);
    font-size: var(--fs-label);
  }
  .band-lunch .warn {
    color: #8a3c06;
  }
  .band-evening .warn {
    color: var(--accent-on-dark);
  }
  .adjust {
    margin-left: 8px;
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--band-soft);
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .adjust:hover,
  .adjust:focus-visible,
  .adjust[aria-expanded='true'] {
    color: var(--band-link);
  }
  .edits {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 6px 0 4px;
    padding: 6px 8px;
    border: 1px dashed var(--band-rule);
    border-radius: 2px;
  }
  .edits label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--band-soft);
  }
  .edits select,
  .edits button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 2px 8px;
    border: 1px solid var(--band-rule);
    border-radius: 2px;
    background: transparent;
    color: var(--band-ink);
    cursor: pointer;
  }
  .band-evening .edits select option {
    color: var(--text-primary);
  }
  .leg {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 10px;
    padding: 0 4px;
    font-size: var(--fs-label-xs);
    line-height: 20px;
    color: var(--band-soft);
  }
  .leg-line {
    justify-self: center;
    width: 0;
    border-left: 2px dotted var(--pencil);
    min-height: 20px;
    opacity: 0.7;
  }
  .guide {
    margin: 2px 0 4px;
    font-size: var(--fs-label);
    line-height: 22px;
    color: var(--band-ink);
  }
  .guide summary {
    cursor: pointer;
    color: var(--band-link);
  }
  .guide ul,
  .guide ol {
    margin: 4px 0;
    padding-left: 18px;
  }
  .guide p {
    margin: 4px 0;
  }
  .guide a {
    color: var(--band-link);
  }
  .mono {
    font-family: var(--font-mono);
  }
  @media (max-width: 640px) {
    .band {
      padding: 12px 12px 10px;
    }
    .stop,
    .leg {
      grid-template-columns: 52px minmax(0, 1fr);
      gap: 8px;
    }
    .time {
      font-size: var(--fs-label-xs);
      line-height: 20px;
      padding-top: 2px;
    }
    .t-to {
      display: block;
      opacity: 0.75;
    }
    .hd-acts {
      margin-left: 0;
      width: 100%;
    }
    .band-hd h3 {
      font-size: 21px;
    }
  }
</style>
