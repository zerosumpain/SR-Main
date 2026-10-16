<script lang="ts">
  // Trips — the notebook's contents page. An ink cover ("Where next?") with
  // the next departure stamped on it, then one ruled sheet: the opening
  // message as an index card you write straight onto (the planner's first
  // turn), the trips still to come as pinned cards, and the trips already
  // been as a plain list in the margin's shadow.
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import DateStamp from '$lib/components/notes-paper/DateStamp.svelte';
  import IndexCard from '$lib/components/notes-paper/IndexCard.svelte';
  import Tally from '$lib/components/notes-paper/Tally.svelte';
  import TripCover from '$lib/components/trips/notes/TripCover.svelte';
  import MarginBlock from '$lib/components/trips/notes/MarginBlock.svelte';
  import { countWord, dateSpan, dayCount, splitTrips, stampDate, tripName, whenFrom } from '$lib/components/trips/notes/notes';
  import { TRAVEL_MODES, type Pace, type TravelMode } from '$lib/trips/model';

  let { data } = $props();

  const split = $derived(splitTrips(data.trips, data.today));
  const next = $derived(split.ahead[0] ?? null);

  // New-trip form. Walk is always on; the zone defaults to the browser's own
  // until a destination suggests otherwise (the person can type any IANA zone).
  let destination = $state('');
  let title = $state('');
  let startDate = $state('');
  let endDate = $state('');
  let timeZone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London');
  let pace = $state<Pace>('normal');
  let modes = $state<TravelMode[]>(['walk', 'transit']);
  let busy = $state(false);
  let message = $state<string | null>(null);
  let opening = $state('');
  let openingEl = $state<HTMLTextAreaElement | null>(null);

  // Prompts that add a line to the opening message, for the things the
  // planner will otherwise have to ask for.
  const PROMPTS = [
    { label: 'Where', text: 'We’re going to ' },
    { label: 'When', text: 'From … to …' },
    { label: 'Who', text: 'Travelling: ' },
    { label: 'Staying', text: 'We’re staying near ' },
    { label: 'Must-sees', text: 'We’d love to see ' },
    { label: 'Travel', text: 'We arrive by … at …' },
  ];
  function addPrompt(text: string) {
    opening = opening.trim() ? `${opening.trimEnd()}\n${text}` : text;
    queueMicrotask(() => {
      openingEl?.focus();
      openingEl?.setSelectionRange(opening.length, opening.length);
    });
  }

  // v2: a trip starts as a conversation — the opening message is the planner's first turn.
  async function start(e: SubmitEvent) {
    e.preventDefault();
    if (!opening.trim()) return;
    busy = true;
    message = null;
    try {
      const res = await fetch('/api/trips', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: opening }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        message = body.error ?? body.message ?? 'Could not start the trip.';
        return;
      }
      await goto(`/trips/${body.id}`);
    } finally {
      busy = false;
    }
  }
  function onOpeningKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
    }
  }

  function toggleMode(m: TravelMode) {
    if (m === 'walk') return;
    modes = modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m];
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    message = null;
    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destination, title: title || undefined, startDate, endDate, timeZone, pace, modes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        message = body.error ?? body.message ?? 'Could not create the trip.';
        return;
      }
      await goto(`/trips/${body.id}`);
    } finally {
      busy = false;
    }
  }

  const STATUS: Record<string, string> = { draft: 'being planned', planned: 'planned', active: 'under way', done: 'done' };
  // A card's tilt, from its place in the list: a degree or so either way.
  const TILTS = [-1.1, 0.8, -0.5, 1.2, -0.9, 0.4];
</script>

<svelte:head><title>Trips</title></svelte:head>

<PageHeader title="Trips" />

<TripCover
  kicker="Trips"
  title="Where next?"
  line="Tell the planner where you’re going. It reads up on every place, lists what to book and when, and works out the days."
  titleId="trips-h"
>
  {#snippet marks()}
    <div class="mark">
      <span class="mark-k">Trips</span>
      <span class="mark-fig">
        <span class="fig">{data.trips.length}</span>
        {#if data.trips.length > 0 && data.trips.length <= 20}<Tally count={data.trips.length} seed={17} height={18} />{/if}
      </span>
    </div>
    {#if next}
      <div class="mark">
        <span class="mark-k">Next away · {whenFrom(next.startDate, next.endDate, data.today)}</span>
        <DateStamp date={stampDate(next.startDate)} sub={tripName(next).name} datetime={next.startDate} tilt={-4} seed={31} />
      </div>
    {/if}
  {/snippet}
</TripCover>

<main class="desk">
  <div class="sheet np-sheet np-tear">
    <MarginBlock kicker="New" aria-labelledby="new-h">
      <h2 id="new-h" class="sheet-h">Start a trip</h2>
      <p class="np-aside lede">Write it as you’d say it. The planner asks for whatever is missing.</p>
      <IndexCard as="div" tilt={0} pin={false} class="opening-card">
        <form class="opening" onsubmit={start}>
          <label class="vh" for="opening">Tell the planner about the trip</label>
          <textarea
            id="opening"
            rows="4"
            bind:this={openingEl}
            bind:value={opening}
            onkeydown={onOpeningKey}
            placeholder="Rome, 27–30 October, two of us, staying near Campo de’ Fiori. We want the Vatican, the Colosseum and good food."
          ></textarea>
          <div class="prompts" aria-label="Add a line about">
            <span class="prompts-k">Add a line:</span>
            {#each PROMPTS as p (p.label)}
              <button type="button" class="prompt" onclick={() => addPrompt(p.text)}>+ {p.label}</button>
            {/each}
          </div>
          <div class="go">
            <button class="pen-btn" type="submit" disabled={busy || !opening.trim()}>{busy ? 'Starting…' : 'Start planning →'}</button>
            <span class="hint">or press Ctrl + Enter</span>
            {#if message}<span class="error" role="alert">{message}</span>{/if}
          </div>
        </form>
      </IndexCard>

      <details class="manual">
        <summary>Or fill in the details yourself</summary>
        <form class="grid" onsubmit={create}>
          <label>Destination<input class="field" bind:value={destination} required placeholder="Rome, Italy" /></label>
          <label>Name <span class="opt">(optional)</span><input class="field" bind:value={title} placeholder="Rome in October" /></label>
          <label>First day<input class="field" type="date" bind:value={startDate} required /></label>
          <label>Last day<input class="field" type="date" bind:value={endDate} required /></label>
          <label>Time zone<input class="field" bind:value={timeZone} required placeholder="Europe/Rome" /></label>
          <label
            >Pace
            <select class="field" bind:value={pace}>
              <option value="relaxed">Relaxed — 9:30 to 18:30</option>
              <option value="normal">Normal — 9:00 to 19:00</option>
              <option value="packed">Packed — 8:00 to 21:00, with dinner</option>
            </select>
          </label>
          <fieldset class="modes">
            <legend>Getting about</legend>
            {#each TRAVEL_MODES as m (m)}
              <label class="check">
                <input type="checkbox" checked={modes.includes(m)} disabled={m === 'walk'} onchange={() => toggleMode(m)} />
                {m === 'transit' ? 'public transport' : m}
              </label>
            {/each}
          </fieldset>
          <div class="go">
            <button class="pen-btn" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create trip'}</button>
          </div>
        </form>
      </details>
    </MarginBlock>

    <MarginBlock kicker="Ahead" aria-labelledby="ahead-h">
      <h2 id="ahead-h" class="sheet-h">Coming up</h2>
      {#if split.ahead.length === 0}
        <p class="np-aside">Nothing booked in yet. Start one above.</p>
      {:else}
        <ul class="cards" role="list">
          {#each split.ahead as t, i (t.id)}
            {@const n = tripName(t)}
            {@const days = dayCount(t.startDate, t.endDate)}
            <li>
              <a class="card-link" href="/trips/{t.id}">
                <IndexCard as="div" tilt={TILTS[i % TILTS.length]} pin={i === 0}>
                  <span class="c-when">{whenFrom(t.startDate, t.endDate, data.today)}</span>
                  <span class="c-title">{n.name}</span>
                  <span class="c-line">{countWord(days)} {days === 1 ? 'day' : 'days'} · {dateSpan(t.startDate, t.endDate)}</span>
                  <span class="c-foot">
                    <span>{n.named ? t.destination : 'not named yet'}</span>
                    <span class="c-status">{t.planVersion ? STATUS[t.status] ?? t.status : 'no plan yet'}</span>
                  </span>
                </IndexCard>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </MarginBlock>

    {#if split.been.length}
      <MarginBlock kicker="Been" aria-labelledby="been-h">
        <h2 id="been-h" class="sheet-h small">Been and gone</h2>
        <ul class="been" role="list">
          {#each split.been as t (t.id)}
            <li>
              <a href="/trips/{t.id}">
                <span class="b-date">{dateSpan(t.startDate, t.endDate)}</span>
                <span class="b-title">{tripName(t).name}</span>
                <span class="b-dest">{t.destination}</span>
              </a>
            </li>
          {/each}
        </ul>
      </MarginBlock>
    {/if}
  </div>
</main>

<style>
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  /* Cover marks */
  .mark {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .mark-k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--on-ink-70);
    white-space: nowrap;
  }
  .mark-fig {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    min-height: 44px;
  }
  .fig {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 40px;
    line-height: 1;
    letter-spacing: -0.03em;
    color: var(--bg);
    font-variant-numeric: tabular-nums;
  }
  .mark-fig :global(.np-tally) {
    margin-bottom: 6px;
  }

  /* The desk and the sheet */
  .desk {
    padding: 0 0 64px;
  }
  .sheet {
    max-width: 1480px;
    margin: 0 auto;
    padding: 34px 0 40px;
    background-image: repeating-linear-gradient(to bottom, transparent 0 31px, var(--np-rule) 31px 32px);
  }
  .sheet-h {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(26px, 3vw, 36px);
    line-height: 1.15;
    letter-spacing: -0.03em;
  }
  .sheet-h.small {
    font-size: clamp(20px, 2.2vw, 26px);
  }
  .lede {
    margin: 2px 0 14px;
  }

  /* The opening card: writing straight onto an index card's lines. */
  :global(.opening-card) {
    max-width: 880px;
    padding: 18px 22px 16px !important;
  }
  .opening textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    min-height: 120px;
    margin: 30px 0 0;
    padding: 0 2px;
    border: 0;
    background: transparent;
    resize: vertical;
    font-family: var(--font-body);
    font-size: 18px;
    line-height: 24px;
    color: var(--np-ink);
  }
  .opening textarea::placeholder {
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--text-muted);
  }
  .opening textarea:focus {
    outline: none;
  }
  :global(.opening-card:focus-within) {
    border-color: var(--accent-ink) !important;
    box-shadow: 0 0 0 2px var(--accent-ink-tint-12, rgba(14, 91, 102, 0.12));
  }
  .prompts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
  }
  .prompts-k {
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--np-ink-soft);
    margin-right: 4px;
  }
  .prompt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    padding: 4px 10px;
    border: 1px dashed var(--np-pen-ink);
    border-radius: 100px;
    background: transparent;
    color: var(--np-pen-ink);
    cursor: pointer;
  }
  .prompt:hover,
  .prompt:focus-visible {
    border-style: solid;
    background: var(--accent-ink-tint-06);
    outline: none;
  }
  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    margin-top: 16px;
    grid-column: 1 / -1;
  }
  .pen-btn {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 16px;
    letter-spacing: -0.01em;
    padding: 10px 18px;
    border: 0;
    border-radius: 2px;
    background: var(--accent);
    color: var(--text-on-accent, #fff);
    cursor: pointer;
  }
  .pen-btn:hover:not(:disabled),
  .pen-btn:focus-visible {
    background: var(--accent-hover);
    outline: none;
  }
  .pen-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .error {
    color: var(--error);
    font-size: var(--fs-label);
  }

  /* The manual form, folded under the card. */
  .manual {
    margin-top: 18px;
    max-width: 880px;
  }
  .manual summary {
    cursor: pointer;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    color: var(--np-pen-ink);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
    gap: 14px 18px;
    margin-top: 14px;
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--np-pen-ink);
  }
  .field {
    font-family: var(--font-body);
    font-size: 16px;
    letter-spacing: 0;
    text-transform: none;
    padding: 6px 2px;
    border: 0;
    border-bottom: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--np-ink);
  }
  .field:focus {
    outline: none;
    border-bottom: 2px solid var(--accent-ink);
  }
  .opt {
    text-transform: none;
    color: var(--text-muted);
  }
  .modes {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    align-items: center;
  }
  .modes legend {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--np-pen-ink);
    margin-bottom: 4px;
  }
  .grid .check {
    flex-direction: row;
    align-items: center;
    text-transform: none;
    letter-spacing: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--np-ink);
  }

  /* Trips to come: pinned index cards. */
  .cards {
    list-style: none;
    margin: 18px 0 0;
    padding: 8px 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr));
    gap: 28px 26px;
  }
  .card-link {
    display: block;
    height: 100%;
    color: inherit;
    text-decoration: none;
  }
  .card-link :global(.np-card) {
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
    transition: transform 160ms ease;
  }
  .card-link:hover :global(.np-card),
  .card-link:focus-visible :global(.np-card) {
    transform: rotate(0deg) translateY(-2px);
    border-color: var(--accent-ink);
  }
  .card-link:focus-visible {
    outline: none;
  }
  .card-link:focus-visible :global(.np-card) {
    outline: 2px solid var(--accent-ink);
    outline-offset: 3px;
  }
  .c-when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--np-pen-text);
    line-height: 20px;
  }
  .c-title {
    margin-top: 10px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 24px;
    line-height: 24px;
    letter-spacing: -0.02em;
  }
  .c-line {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    line-height: 24px;
    color: var(--np-ink-soft);
  }
  .c-foot {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-top: auto;
    padding-top: 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 24px;
    color: var(--np-ink-soft);
  }
  .c-status {
    color: var(--np-pen-ink);
  }

  /* Trips already been: a plain list. */
  .been {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  .been a {
    display: grid;
    grid-template-columns: 9.5rem minmax(0, 1fr) auto;
    gap: 12px;
    align-items: baseline;
    padding: 4px 0;
    line-height: 24px;
    color: inherit;
    text-decoration: none;
  }
  .been a:hover .b-title {
    text-decoration: underline;
    text-decoration-color: var(--accent);
  }
  .b-date,
  .b-dest {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-ink-soft);
  }
  .b-title {
    font-weight: 600;
  }
  @media (max-width: 760px) {
    .mark-fig :global(.np-tally) {
      display: none;
    }
    .sheet {
      padding-top: 26px;
    }
    .been a {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
    .hint {
      display: none;
    }
  }
</style>
