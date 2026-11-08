<script lang="ts">
  // Kelloggle (the boggle game) on the TV: the letter grid large on the left for everyone to trace,
  // and beside it the clock, the Kelly-word hint and each player's COUNT and
  // score — never a word, which would hand them to the rest of the room. At the
  // finish the grid side turns into the reveal: who won, the Kelly word and who
  // found it, the best words with their finders (crossed out where they were
  // shared under classic scoring), and the words nobody saw. Drawn from the
  // room's `toScreen` wire alone.
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { STING } from '$lib/games/kelly';
  import type { ScreenRoom } from '$lib/games/boggle';

  let { room, skewMs = 0 }: { room: ScreenRoom; skewMs?: number } = $props();

  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(t);
  });

  // The lists on the reveal are capped so the stage never scrolls.
  const FOUND_SHOWN = 12;
  const MISSED_SHOWN = 8;
  const STANDINGS_SHOWN = 6;

  const serverNow = $derived(now + skewMs);
  const playing = $derived(room.phase === 'playing');
  const finished = $derived(room.phase === 'finished');
  const msLeft = $derived(room.phaseEndsAt === null ? null : Math.max(0, room.phaseEndsAt - serverNow));
  const secondsLeft = $derived(msLeft === null ? null : Math.ceil(msLeft / 1000));
  const clock = $derived.by(() => {
    const s = playing ? (secondsLeft ?? 0) : finished ? 0 : Math.round(room.timeLimitMs / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  const low = $derived(playing && secondsLeft !== null && secondsLeft <= 10);
  const drain = $derived(
    playing && msLeft !== null && room.timeLimitMs > 0 ? Math.max(0, Math.min(1, msLeft / room.timeLimitMs)) : finished ? 0 : 1,
  );

  /** A face is one letter or two (`qu`, and the big board's `th`, `an`…): first letter capital. */
  const face = (f: string) => (f ? f[0].toUpperCase() + f.slice(1).toLowerCase() : '');
  const cells = $derived(room.grid ?? Array.from({ length: room.size * room.size }, () => ''));

  const board = $derived([...room.players].sort((a, b) => b.score - a.score || b.wordCount - a.wordCount || a.name.localeCompare(b.name)));
  const nameOf = (id: string) => room.players.find((p) => p.id === id)?.name ?? room.standings?.find((s) => s.id === id)?.name ?? '?';

  const winnerLine = $derived.by(() => {
    if (!finished) return '';
    const top = room.standings?.[0]?.score ?? 0;
    const names = room.winnerIds.map(nameOf);
    if (names.length > 1) return `${names.join(' and ')} draw on ${top}`;
    if (names.length === 1) return `${names[0]} wins with ${top}`;
    if ((room.standings?.length ?? 0) === 1 && top > 0) return `${room.standings![0].name} scores ${top}`;
    return 'Nobody scored this round';
  });
  const kellyFound = $derived(room.kellyWord ? (room.found?.find((f) => f.word === room.kellyWord) ?? null) : null);
  const foundShown = $derived((room.found ?? []).filter((f) => f.word !== room.kellyWord).slice(0, FOUND_SHOWN));
  const foundMore = $derived(Math.max(0, (room.found?.length ?? 0) - (kellyFound ? 1 : 0) - foundShown.length));
  const missedShown = $derived((room.missed ?? []).slice(0, MISSED_SHOWN));
  const standingsShown = $derived((room.standings ?? []).slice(0, STANDINGS_SHOWN));

  const headline = $derived.by(() => {
    switch (room.phase) {
      case 'lobby':
        return 'Waiting for the host';
      case 'countdown':
        return 'Get ready';
      case 'playing':
        return `Find words of ${room.minLength} letters or more`;
      case 'finished':
        return winnerLine;
      default:
        return 'This game has ended';
    }
  });
</script>

<div class="boggle-root" style:--boggle-n={room.size}>
  <header class="boggle-top">
    <span class="boggle-brand"><span class="boggle-mark">sr.</span> kelloggle</span>
    {#key headline}
      <h1 class="boggle-headline" in:fly={{ y: -12, duration: 380 }}>{headline}</h1>
    {/key}
    <span class="boggle-meta">
      <span>{room.size}×{room.size}</span>
      <span>{room.scoring === 'classic' ? 'Classic scoring' : 'Every word scores'}</span>
    </span>
  </header>

  <div class="boggle-body">
    <main class="boggle-left">
      {#if finished}
        <div class="boggle-reveal" in:fade={{ duration: 420 }}>
          <div class="boggle-reveal-col">
            <p class="boggle-kicker">Standings</p>
            <ol class="boggle-standings">
              {#each standingsShown as s, i (s.id)}
                <li
                  class="boggle-standing"
                  class:boggle-standing-win={room.winnerIds.includes(s.id)}
                  in:fly={{ y: 24, duration: 460, delay: 200 + i * 120, easing: cubicOut }}
                >
                  <span class="boggle-place">{i + 1}</span>
                  <span class="boggle-sname">{s.name}</span>
                  <span class="boggle-swords">{s.words} {s.words === 1 ? 'word' : 'words'}</span>
                  <span class="boggle-sscore">{s.score}</span>
                </li>
              {/each}
            </ol>

            {#if room.kellyWord}
              <div class="boggle-kelly boggle-kelly-reveal" in:fade={{ delay: 700, duration: 400 }}>
                <p class="boggle-kicker boggle-kicker-accent">The Kelly word</p>
                <p class="boggle-kelly-word">{room.kellyWord.toUpperCase()}</p>
                <p class="boggle-kelly-note">
                  {#if kellyFound}
                    Found by {kellyFound.finders.join(', ')}{kellyFound.points > 0 ? ` for ${kellyFound.points}` : ', shared, so crossed out'}
                  {:else}
                    Nobody found it
                  {/if}
                </p>
              </div>
            {/if}
          </div>

          <div class="boggle-reveal-col">
            <p class="boggle-kicker">Best words found</p>
            {#if foundShown.length}
              <ul class="boggle-words">
                {#each foundShown as f, i (f.word)}
                  <li
                    class="boggle-word"
                    class:boggle-word-out={f.shared && f.points === 0}
                    in:fly={{ x: 20, duration: 360, delay: 400 + i * 60, easing: cubicOut }}
                  >
                    <span class="boggle-wtext">{f.word.toUpperCase()}</span>
                    <span class="boggle-wwho">{f.finders.join(', ')}</span>
                    <span class="boggle-wpts">{f.points}</span>
                  </li>
                {/each}
              </ul>
              {#if foundMore > 0}
                <p class="boggle-more">and {foundMore} more</p>
              {/if}
            {:else}
              <p class="boggle-more">No words were found</p>
            {/if}

            {#if missedShown.length}
              <p class="boggle-kicker boggle-kicker-gap">Missed</p>
              <ul class="boggle-missed">
                {#each missedShown as m (m.word)}
                  <li class="boggle-miss">{m.word.toUpperCase()} <span>{m.points}</span></li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      {:else}
        <div class="boggle-gridwrap">
          {#key !!room.grid}
          <div class="boggle-tiles" class:boggle-tiles-blank={!room.grid}>
            {#each cells as c, i (i)}
              <span class="boggle-tile" class:boggle-tile-two={c.length > 1} in:scale={{ start: 0.6, duration: 380, delay: (i % 7) * 40, easing: cubicOut }}>
                {face(c)}
              </span>
            {/each}
          </div>
          {/key}
          {#if !room.grid}
            <div class="boggle-ready" in:fade>
              {#if room.phase === 'countdown'}
                <p class="boggle-ready-label">Get ready</p>
                {#key secondsLeft}
                  <span class="boggle-ready-num" in:scale={{ start: 1.6, duration: 600, easing: cubicOut }}>{secondsLeft ?? ''}</span>
                {/key}
              {:else if room.phase === 'lobby'}
                <p class="boggle-ready-label">Get ready</p>
                <p class="boggle-ready-note">Waiting for the host to start</p>
              {:else}
                <p class="boggle-ready-label">This game has ended</p>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </main>

    <aside class="boggle-side">
      <div class="boggle-clock" class:boggle-clock-low={low}>
        <span class="boggle-clock-time">{clock}</span>
        <span class="boggle-clock-bar" aria-hidden="true">
          <span class="boggle-clock-drain" style:transform="scaleX({drain})"></span>
        </span>
      </div>

      {#if room.kellyHint}
        <div class="boggle-kelly" in:fly={{ y: 16, duration: 420 }}>
          <p class="boggle-kicker boggle-kicker-accent">Kelly word · worth double</p>
          <p class="boggle-kelly-hint">
            {room.kellyHint.length} letters, starts with <strong>{room.kellyHint.first.toUpperCase()}</strong>
          </p>
        </div>
      {/if}

      <p class="boggle-kicker">{room.phase === 'lobby' ? 'At the table' : 'Players'}</p>
      <div class="boggle-players">
        {#each board as p, i (p.id)}
          <div
            class="boggle-player"
            class:boggle-player-lead={(playing || finished) && i === 0 && p.score > 0}
            animate:flip={{ duration: 600, easing: cubicOut }}
            in:fly={{ x: 30, duration: 360 }}
          >
            <span class="boggle-pname">{p.name}</span>
            <span class="boggle-pcount">{p.wordCount} {p.wordCount === 1 ? 'word' : 'words'}</span>
            <span class="boggle-pscore">{p.score}</span>
          </div>
        {/each}
      </div>
    </aside>
  </div>

  <footer class="boggle-foot"><span class="boggle-mark">sr.</span> {STING}</footer>
</div>

<style>
  .boggle-root {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    padding: 1.6cqw 2cqw 1.2cqw;
    gap: 1.2cqw;
    font-family: var(--font-body);
    color: var(--chrome-ink);
  }
  .boggle-top {
    display: flex;
    align-items: baseline;
    gap: 1.6cqw;
    border-bottom: 1px solid var(--on-ink-14);
    padding-bottom: 0.9cqw;
    min-width: 0;
  }
  .boggle-brand,
  .boggle-meta {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
    white-space: nowrap;
  }
  .boggle-meta {
    display: flex;
    gap: 1.2cqw;
    letter-spacing: 0.08em;
  }
  .boggle-mark {
    font-family: var(--font-brand);
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent-on-dark);
  }
  .boggle-headline {
    margin: 0;
    flex: 1;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.3cqw;
    letter-spacing: -0.015em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .boggle-body {
    display: grid;
    grid-template-columns: 54cqw minmax(0, 1fr);
    gap: 2.6cqw;
    min-height: 0;
  }
  .boggle-left {
    position: relative;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
  }
  .boggle-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .boggle-kicker-accent {
    color: var(--accent-on-dark);
  }
  .boggle-kicker-gap {
    margin-top: 1.4cqw;
  }

  /* The grid: square, as tall as the body allows. */
  .boggle-gridwrap {
    position: relative;
    height: 100%;
    aspect-ratio: 1;
    max-width: 100%;
    display: grid;
    place-items: center;
  }
  .boggle-tiles {
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: repeat(var(--boggle-n), 1fr);
    grid-template-rows: repeat(var(--boggle-n), 1fr);
    gap: 0.8cqw;
    padding: 0.8cqw;
    border-radius: 2px;
    background: var(--on-ink-08);
    border: 1px solid var(--on-ink-14);
    box-sizing: border-box;
  }
  .boggle-tile {
    display: grid;
    place-items: center;
    border-radius: 2px;
    background: var(--chrome-ink);
    color: var(--chrome-bg);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: calc(28cqw / var(--boggle-n));
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .boggle-tile-two {
    font-size: calc(19cqw / var(--boggle-n));
  }
  .boggle-tiles-blank .boggle-tile {
    background: var(--on-ink-05);
    border: 1px solid var(--on-ink-12);
  }
  .boggle-ready {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1cqw;
    text-align: center;
  }
  .boggle-ready-label {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 4.4cqw;
    letter-spacing: -0.02em;
  }
  .boggle-ready-num {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 14cqw;
    line-height: 1;
    color: var(--accent-on-dark);
  }
  .boggle-ready-note {
    margin: 0;
    font-size: 1.6cqw;
    color: var(--on-ink-80);
  }

  /* The right column. */
  .boggle-side {
    display: flex;
    flex-direction: column;
    gap: 1.2cqw;
    min-height: 0;
    min-width: 0;
  }
  .boggle-clock {
    display: grid;
    gap: 0.6cqw;
  }
  .boggle-clock-time {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 9cqw;
    line-height: 0.95;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    transition: color 300ms ease;
  }
  .boggle-clock-low .boggle-clock-time {
    color: var(--accent-on-dark);
  }
  .boggle-clock-bar {
    display: block;
    height: 0.5cqw;
    border-radius: 100px;
    background: var(--on-ink-08);
    overflow: hidden;
  }
  .boggle-clock-drain {
    display: block;
    height: 100%;
    background: var(--chrome-ink);
    transform-origin: left center;
    transition:
      transform 250ms linear,
      background-color 300ms ease;
  }
  .boggle-clock-low .boggle-clock-drain {
    background: var(--accent-on-dark);
  }
  .boggle-kelly {
    padding: 1cqw 1.3cqw;
    border: 1px solid var(--accent-on-dark);
    border-radius: 2px;
    background: var(--on-ink-05);
  }
  .boggle-kelly-hint {
    margin: 0.4cqw 0 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2cqw;
    line-height: 1.15;
  }
  .boggle-kelly-hint strong {
    color: var(--accent-on-dark);
  }
  .boggle-kelly-reveal {
    margin-top: 1.6cqw;
  }
  .boggle-kelly-word {
    margin: 0.3cqw 0 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3.4cqw;
    letter-spacing: 0.04em;
    color: var(--accent-on-dark);
  }
  .boggle-kelly-note {
    margin: 0.2cqw 0 0;
    font-size: 1.4cqw;
    color: var(--on-ink-80);
  }
  .boggle-players {
    display: grid;
    gap: 0.6cqw;
    min-height: 0;
    overflow: hidden;
  }
  .boggle-player {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 5cqw;
    align-items: center;
    gap: 1cqw;
    padding: 0.7cqw 1.1cqw;
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
    background: var(--on-ink-05);
    transition: border-color 300ms ease;
  }
  .boggle-player-lead {
    border-color: var(--accent-on-dark);
  }
  .boggle-pname {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.8cqw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .boggle-pcount {
    font-family: var(--font-mono);
    font-size: 1.2cqw;
    color: var(--on-ink-70);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .boggle-pscore {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2cqw;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* The reveal. */
  .boggle-reveal {
    align-self: stretch;
    justify-self: stretch;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2.4cqw;
    min-height: 0;
    overflow: hidden;
  }
  .boggle-reveal-col {
    display: flex;
    flex-direction: column;
    gap: 0.7cqw;
    min-width: 0;
    min-height: 0;
  }
  .boggle-standings,
  .boggle-words,
  .boggle-missed {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .boggle-standings {
    display: grid;
    gap: 0.6cqw;
  }
  .boggle-standing {
    display: grid;
    grid-template-columns: 2cqw minmax(0, 1fr) auto 4.5cqw;
    align-items: center;
    gap: 0.9cqw;
    padding: 0.7cqw 1cqw;
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
  }
  .boggle-standing-win {
    border-color: var(--accent-on-dark);
    background: var(--on-ink-05);
  }
  .boggle-place {
    font-family: var(--font-mono);
    font-size: 1.2cqw;
    color: var(--on-ink-55);
  }
  .boggle-sname {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.9cqw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .boggle-standing-win .boggle-sname,
  .boggle-standing-win .boggle-sscore {
    color: var(--accent-on-dark);
  }
  .boggle-swords {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    color: var(--on-ink-55);
    white-space: nowrap;
  }
  .boggle-sscore {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2cqw;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .boggle-words {
    display: grid;
    gap: 0.25cqw;
  }
  .boggle-word {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 2.6cqw;
    align-items: baseline;
    gap: 0.9cqw;
    padding: 0.3cqw 0;
    border-bottom: 1px solid var(--on-ink-08);
  }
  .boggle-wtext {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.6cqw;
    letter-spacing: 0.03em;
  }
  .boggle-wwho {
    font-size: 1.2cqw;
    color: var(--on-ink-70);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .boggle-wpts {
    font-family: var(--font-mono);
    font-size: 1.3cqw;
    text-align: right;
    color: var(--accent-ink-on-dark);
  }
  .boggle-word-out .boggle-wtext {
    text-decoration: line-through;
    text-decoration-thickness: 0.18cqw;
    color: var(--on-ink-45);
  }
  .boggle-word-out .boggle-wpts {
    color: var(--on-ink-45);
  }
  .boggle-more {
    margin: 0.4cqw 0 0;
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--on-ink-45);
  }
  .boggle-missed {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5cqw;
  }
  .boggle-miss {
    padding: 0.25cqw 0.7cqw;
    border: 1px dashed var(--on-ink-30);
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 1.2cqw;
    color: var(--on-ink-80);
  }
  .boggle-miss span {
    color: var(--on-ink-45);
  }
  .boggle-foot {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.08em;
    color: var(--on-ink-45);
  }
  @media (prefers-reduced-motion: reduce) {
    .boggle-clock-drain {
      transition: none;
    }
  }
</style>
