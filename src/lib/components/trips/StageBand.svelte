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
  } = $props();

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
    <h3>{DAY_STAGE_LABEL[stage]}</h3>
    {#if span}<span class="span mono">{span}</span>{/if}
    <button class="ask" type="button" disabled={busy} onclick={() => onAsk(`For ${dayName}, ${ASK[stage]}: `)}>Ask about this stage</button>
  </header>

  {#if !items.some((i) => i.stop.kind !== 'stay')}
    <p class="free">Free — nothing planned. <button class="link" type="button" onclick={() => onAsk(`Something for ${dayName}, ${ASK[stage]}?`)}>Ask for an idea</button></p>
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
        <span class="time mono">{hhmm(s.arriveMin)}{s.departMin !== s.arriveMin ? `–${hhmm(s.departMin)}` : ''}</span>
        <span class="body">
          {#if s.kind === 'transport'}<span class="tag mono">{s.id.endsWith(':arrive') ? 'Arrive' : 'Leave'}</span>{:else if s.kind === 'meal'}<span class="tag mono">Meal</span>{/if}
          <strong class="title">{s.title}</strong>
          {#if s.bookingId}<span class="tag mono">booked</span>{/if}
          {#if s.waitSec >= 60}<span class="note"> · {waitText(s.waitSec)}</span>{/if}
          {#each s.warnings as wn, wi (wi)}<span class="warn">{wn}</span>{/each}
          {#if s.kind === 'wish' && s.wishId}
            {@const w = wishOf(s.wishId)}
            {#if w}
              <span class="edits">
                <select aria-label="Move {s.title} to another day" value={w.fixedDate ?? ''} disabled={busy} onchange={(e) => onPatch(w, { fixedDate: e.currentTarget.value || null }, 'Moved.')}>
                  <option value="">any day</option>
                  {#each dates as d (d)}<option value={d}>{dateLabel(d)}</option>{/each}
                </select>
                <button type="button" disabled={busy} onclick={() => onPatch(w, { locked: !w.locked }, w.locked ? 'Unlocked.' : 'Locked to this day and time.')}>{w.locked ? 'Unlock' : 'Lock'}</button>
                <button type="button" disabled={busy} onclick={() => onPatch(w, { priority: w.priority === 'must' ? 'nice' : 'must' })}>{w.priority === 'must' ? 'Must' : 'Nice'}</button>
              </span>
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
  .band {
    --band-ink: var(--text-primary);
    --band-soft: var(--text-secondary);
    --band-rule: var(--line-strong);
    --band-link: var(--accent-ink);
    position: relative;
    padding: 16px 18px 14px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    color: var(--band-ink);
  }
  /* Breakfast & morning — paper with a fine petrol grain. */
  .band-morning {
    background-color: var(--surface-card);
    background-image: radial-gradient(var(--accent-ink-tint-12) 1px, transparent 1.2px);
    background-size: 10px 10px;
    border-left: 4px solid var(--accent-ink);
  }
  .band-morning h3 {
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: var(--fs-label);
    color: var(--accent-ink);
  }
  /* Lunch — a warm orange wash, display heading. */
  .band-lunch {
    background: var(--accent-tint-08);
    border-top: 3px solid var(--accent);
  }
  .band-lunch h3 {
    font-family: var(--font-display);
    font-size: 1.35rem;
    color: var(--accent);
  }
  /* Afternoon — the rail colour with a quiet diagonal hatch. */
  .band-afternoon {
    background-color: var(--surface-rail);
    background-image: repeating-linear-gradient(135deg, var(--surface-overlay) 0 2px, transparent 2px 9px);
  }
  .band-afternoon h3 {
    font-family: var(--font-display);
    font-size: 1.2rem;
    text-decoration: underline;
    text-decoration-color: var(--accent-ink);
    text-decoration-thickness: 2px;
    text-underline-offset: 6px;
  }
  /* Dinner & evening — the ink ground of the site's bar. */
  .band-evening {
    --band-ink: var(--chrome-ink);
    --band-soft: var(--accent-ink-on-dark);
    --band-rule: var(--accent-on-dark-40);
    --band-link: var(--accent-on-dark);
    background: var(--chrome-bg);
    border-color: var(--chrome-bg);
  }
  .band-evening h3 {
    font-family: var(--font-display);
    font-size: 1.35rem;
    color: var(--accent-on-dark);
  }
  .band-hd {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px 12px;
    margin-bottom: 8px;
  }
  .band-hd h3 {
    margin: 0;
  }
  .span {
    font-size: var(--fs-label-xs);
    color: var(--band-soft);
  }
  .ask {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 3px 10px;
    border: 1px solid var(--band-rule);
    border-radius: 100px;
    background: transparent;
    color: var(--band-ink);
    cursor: pointer;
  }
  .ask:hover:not(:disabled),
  .ask:focus-visible {
    border-color: var(--band-link);
    color: var(--band-link);
  }
  .free {
    margin: 4px 0;
    color: var(--band-soft);
    font-size: var(--fs-label);
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
  .stops {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .stop {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 10px;
    padding: 6px 4px;
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
    padding-top: 2px;
  }
  .title {
    font-weight: 600;
  }
  .kind-stay .title,
  .kind-meal .title {
    font-weight: 400;
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
  .note {
    color: var(--band-soft);
    font-size: var(--fs-label);
  }
  .warn {
    display: block;
    color: var(--warn);
    font-size: var(--fs-label);
  }
  .band-evening .warn {
    color: var(--accent-on-dark);
  }
  .edits {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin-top: 4px;
  }
  .edits select,
  .edits button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 1px 6px;
    border: 1px solid var(--band-rule);
    border-radius: 2px;
    background: transparent;
    color: var(--band-ink);
  }
  .band-evening .edits select option {
    color: var(--text-primary);
  }
  .leg {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 10px;
    padding: 0 4px;
    font-size: var(--fs-label-xs);
    color: var(--band-soft);
  }
  .leg-line {
    justify-self: center;
    width: 0;
    border-left: 2px dashed var(--band-rule);
    min-height: 18px;
  }
  .guide {
    margin: 2px 0 4px;
    font-size: var(--fs-label);
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
      grid-template-columns: 70px minmax(0, 1fr);
      gap: 8px;
    }
    .ask {
      margin-left: 0;
    }
  }
</style>
