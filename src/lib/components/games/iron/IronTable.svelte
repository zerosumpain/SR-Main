<script lang="ts">
  // Iron Roads on the TV: the map, big, with the players, the turn clock, the
  // five face-up cards and what just happened down the side. Drawn from the
  // room's `toScreen` wire alone (no hands, no tickets until the finish); the
  // phones are where the moves are made.
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import type { ScreenRoom } from '$lib/games/iron-roads';
  import { ticketName } from '$lib/games/iron-roads-map';
  import IronMap from './IronMap.svelte';
  import IronCard from './IronCard.svelte';
  import { playerPaint } from './colours';

  let { room, skewMs = 0 }: { room: ScreenRoom; skewMs?: number } = $props();

  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(t);
  });

  const serverNow = $derived(now + skewMs);
  const seated = $derived([...room.players].filter((p) => p.seat !== null).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0)));
  const seats = $derived(Object.fromEntries(room.players.map((p) => [p.id, p.seat])));
  const mover = $derived(room.players.find((p) => p.id === room.turnId) ?? null);
  const nameOf = (id: string) => room.players.find((p) => p.id === id)?.name ?? '?';
  const secondsLeft = $derived(room.phaseEndsAt === null ? null : Math.max(0, Math.ceil((room.phaseEndsAt - serverNow) / 1000)));
  const remaining = $derived.by(() => {
    if ((room.phase !== 'playing' && room.phase !== 'choosing') || room.phaseEndsAt === null || room.turnStartedAt === null) return null;
    const total = room.phaseEndsAt - room.turnStartedAt;
    return total > 0 ? Math.max(0, Math.min(1, (room.phaseEndsAt - serverNow) / total)) : null;
  });
  const joined = $derived(room.players.filter((p) => p.status === 'joined'));
  const invited = $derived(room.players.filter((p) => p.status === 'invited'));
  const choosing = $derived(room.players.filter((p) => p.choosing));

  const headline = $derived.by(() => {
    switch (room.phase) {
      case 'lobby':
        return 'Waiting for the host to start';
      case 'countdown':
        return 'Shuffling the cards';
      case 'choosing':
        return 'Pick your tickets on your phones';
      case 'playing':
        if (!mover) return 'Playing';
        if (mover.choosing) return `${mover.name} is choosing tickets`;
        return room.drawn > 0 ? `${mover.name} to draw a second card` : `${mover.name} to play`;
      case 'finished': {
        const names = room.winnerIds.map(nameOf);
        return names.length > 1 ? `${names.join(' and ')} share it` : names.length ? `${names[0]} wins` : 'Game over';
      }
      default:
        return 'This game has ended';
    }
  });
  const finalLine = $derived.by(() => {
    if (!room.finalRound || room.phase !== 'playing') return null;
    const left = room.finalRound.left.length;
    const who = room.finalRound.byId ? `${nameOf(room.finalRound.byId)} is nearly out of trains` : 'Time is nearly up';
    return `Last round — ${who}. ${left} ${left === 1 ? 'turn' : 'turns'} to go.`;
  });
  const lastLine = $derived(room.last ?? room.log.at(-1)?.text ?? '');
  const standings = $derived(room.standings ?? []);
  const longestTop = $derived(Math.max(0, ...standings.map((s) => s.longest)));
</script>

<div class="iron">
  <header class="iron-top">
    <span class="iron-brand"><span class="iron-mark">sr.</span> iron roads</span>
    {#key headline}
      <h1 in:fly={{ y: -12, duration: 380 }}>{headline}</h1>
    {/key}
    <span class="iron-meta">
      {#if room.phase === 'playing' || room.phase === 'choosing'}
        <span>deck {room.deck}</span>
        <span>tickets {room.ticketDeck}</span>
      {/if}
      {#if (room.phase === 'playing' || room.phase === 'choosing' || room.phase === 'countdown') && secondsLeft !== null}
        <span class="iron-clock" class:iron-late={secondsLeft <= 10 && room.phase !== 'countdown'}>{secondsLeft}s</span>
      {/if}
    </span>
  </header>

  <div class="iron-body">
    <div class="iron-board">
      <div class="iron-mapwrap" class:iron-dim={room.phase !== 'playing' && room.phase !== 'choosing'}>
        <IronMap owners={room.owners} {seats} lastRoute={room.phase === 'playing' ? room.lastRoute : null} />
      </div>
      {#if finalLine}
        <p class="iron-final-banner" in:fly={{ y: -20, duration: 420 }}>{finalLine}</p>
      {/if}

      {#if room.phase === 'lobby' || room.phase === 'countdown'}
        <div class="iron-overlay" in:fade>
          <p class="iron-kicker">Iron Roads · Darlington Edition</p>
          <p class="iron-pitch">Lay track between the towns, join up your secret tickets, and keep the longest line.</p>
          <ul class="iron-waiting">
            {#each joined as p (p.id)}
              <li in:fly={{ y: 16, duration: 360 }}>{p.name}{p.isHost ? ' · host' : ''}</li>
            {/each}
            {#each invited as p (p.id)}
              <li class="iron-asked">{p.name} · asked</li>
            {/each}
          </ul>
          {#if room.phase === 'countdown'}
            <p class="iron-count">{secondsLeft ?? ''}</p>
          {/if}
        </div>
      {/if}

      {#if room.phase === 'finished' && standings.length}
        <div class="iron-overlay iron-results" in:fly={{ y: 30, duration: 520 }}>
          <p class="iron-kicker">Final scores</p>
          <ol class="iron-standings">
            {#each standings as s (s.id)}
              <li class:iron-won={s.result === 'won' || s.result === 'drew'}>
                <span class="iron-place">{s.place}</span>
                <span class="iron-swatch" style:background={playerPaint(s.seat)}></span>
                <span class="iron-who">{s.name}</span>
                <span class="iron-break">
                  routes {s.routePoints} · tickets {s.ticketPoints >= 0 ? '+' : ''}{s.ticketPoints}{s.longestBonus ? ` · longest line +${s.longestBonus}` : ''}
                </span>
                <span class="iron-pts">{s.score}</span>
                <span class="iron-tix">
                  {#each s.tickets as t (t.id)}
                    <span class="iron-tix-chip" class:iron-done={t.done}>{ticketName({ a: t.from, b: t.to })} {t.done ? '+' : '−'}{t.points}</span>
                  {/each}
                </span>
              </li>
            {/each}
          </ol>
          <p class="iron-note">Longest line: {longestTop} trains. The host can start another from their phone.</p>
        </div>
      {/if}
    </div>

    <aside class="iron-side">
      <ul class="iron-players">
        {#each seated.length ? seated : joined as p (p.id)}
          {@const on = p.id === room.turnId}
          <li class="iron-player" class:iron-on={on} class:iron-gone={p.status !== 'joined'} style:--iron-paint={playerPaint(p.seat)}>
            <span class="iron-chip"></span>
            <span class="iron-pname">{p.name}</span>
            <span class="iron-pscore">{p.score}</span>
            <span class="iron-pstats">
              {#if p.status !== 'joined'}left the game{:else}{p.trains} trains · {p.cards} cards ·
                {#if p.choosing}<span class="iron-hot">choosing tickets</span>{:else}{p.tickets} tickets{/if}{/if}
              {#if p.away}<span class="iron-quiet"> · away</span>{/if}
            </span>
            {#if on && remaining !== null}
              <span class="iron-bar"><span style:width="{remaining * 100}%"></span></span>
            {/if}
          </li>
        {/each}
      </ul>

      {#if room.phase === 'playing' || room.phase === 'choosing'}
        <section class="iron-market">
          <p class="iron-kicker">Face up</p>
          <div class="iron-cards">
            {#each room.market as c, i (i)}
              {#if c}
                {#key c}
                  <span in:fly={{ y: -14, duration: 320 }}><IronCard card={c} /></span>
                {/key}
              {:else}
                <span class="iron-empty"></span>
              {/if}
            {/each}
          </div>
          <p class="iron-deckline">{room.deck} in the deck · {room.discard} discarded</p>
        </section>
      {/if}

      {#if room.phase === 'choosing'}
        <p class="iron-last">Keep at least two of your three tickets. {choosing.length ? `Waiting on ${choosing.map((p) => p.name).join(', ')}.` : ''}</p>
      {:else if lastLine && room.phase === 'playing'}
        {#key lastLine}
          <p class="iron-last" in:fly={{ x: -20, duration: 360 }}>{lastLine}</p>
        {/key}
      {/if}
    </aside>
  </div>
</div>

<style>
  .iron {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    padding: 1.4cqw 1.8cqw 1.2cqw;
    gap: 0.8cqw;
    font-family: var(--font-body);
    color: var(--chrome-ink);
  }
  .iron-top {
    display: flex;
    align-items: baseline;
    gap: 1.6cqw;
    border-bottom: 1px solid var(--on-ink-14);
    padding-bottom: 0.8cqw;
  }
  .iron-brand {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
    white-space: nowrap;
  }
  .iron-mark {
    font-family: var(--font-brand);
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent-on-dark);
  }
  h1 {
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
  .iron-meta {
    display: flex;
    align-items: baseline;
    gap: 1.2cqw;
    font-family: var(--font-mono);
    font-size: 1cqw;
    color: var(--on-ink-55);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }
  .iron-clock {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2cqw;
    letter-spacing: 0;
    text-transform: none;
    font-variant-numeric: tabular-nums;
    color: var(--chrome-ink);
  }
  .iron-clock.iron-late {
    color: var(--accent-on-dark);
  }
  .iron-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 21cqw;
    gap: 1.4cqw;
    min-height: 0;
  }
  .iron-board {
    position: relative;
    min-height: 0;
    min-width: 0;
  }
  .iron-mapwrap {
    position: absolute;
    inset: 0;
    transition: opacity 600ms ease;
  }
  .iron-mapwrap.iron-dim {
    opacity: 0.22;
  }
  .iron-final-banner {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 0.6cqw 1.4cqw;
    border-radius: 2px;
    background: var(--accent);
    color: var(--chrome-ink);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.4cqw;
    white-space: nowrap;
  }
  .iron-overlay {
    position: absolute;
    inset: 1cqw 3cqw;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 1cqw;
    padding: 2cqw 2.4cqw;
    background: var(--chrome-bg);
    border: 1px solid var(--on-ink-16);
    border-radius: 4px;
    text-align: center;
  }
  .iron-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .iron-pitch {
    margin: 0;
    max-width: 40cqw;
    font-size: 1.5cqw;
    color: var(--on-ink-80);
  }
  .iron-waiting {
    list-style: none;
    margin: 0.6cqw 0 0;
    padding: 0;
    display: grid;
    gap: 0.5cqw;
  }
  .iron-waiting li {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.3cqw;
  }
  .iron-waiting .iron-asked {
    color: var(--on-ink-45);
  }
  .iron-count {
    margin: 0.6cqw 0 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 6cqw;
    color: var(--accent-on-dark);
  }
  .iron-results {
    inset: 0 3cqw;
    height: fit-content;
    max-height: 100%;
    margin: auto 0;
    align-items: stretch;
    justify-content: flex-start;
    text-align: left;
    overflow: hidden;
    border-color: var(--good-on-dark);
  }
  .iron-standings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.9cqw;
  }
  .iron-standings li {
    display: grid;
    grid-template-columns: 2cqw 1.2cqw auto 1fr auto;
    grid-template-areas: 'place sw who break pts' '. . tix tix tix';
    align-items: baseline;
    column-gap: 1cqw;
    row-gap: 0.3cqw;
  }
  .iron-place {
    grid-area: place;
    font-family: var(--font-mono);
    font-size: 1.2cqw;
    color: var(--on-ink-55);
  }
  .iron-swatch {
    grid-area: sw;
    width: 1.2cqw;
    height: 1.2cqw;
    border-radius: 100px;
  }
  .iron-who {
    grid-area: who;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2cqw;
  }
  .iron-won .iron-who,
  .iron-won .iron-pts {
    color: var(--good-on-dark);
  }
  .iron-break {
    grid-area: break;
    font-family: var(--font-mono);
    font-size: 1cqw;
    color: var(--on-ink-55);
  }
  .iron-pts {
    grid-area: pts;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.2cqw;
    font-variant-numeric: tabular-nums;
  }
  .iron-tix {
    grid-area: tix;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4cqw;
  }
  .iron-tix-chip {
    padding: 0.2cqw 0.6cqw;
    border-radius: 2px;
    border: 1px solid var(--on-ink-30);
    font-size: 0.95cqw;
    color: var(--on-ink-55);
    text-decoration: line-through;
  }
  .iron-tix-chip.iron-done {
    border-color: var(--good-on-dark);
    color: var(--chrome-ink);
    text-decoration: none;
  }
  .iron-note {
    margin: 0.4cqw 0 0;
    font-size: 1.1cqw;
    color: var(--on-ink-55);
  }
  .iron-side {
    display: flex;
    flex-direction: column;
    gap: 1.2cqw;
    min-height: 0;
  }
  .iron-players {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5cqw;
  }
  .iron-player {
    position: relative;
    display: grid;
    grid-template-columns: 1.3cqw 1fr auto;
    grid-template-areas: 'chip name score' '. stats stats';
    align-items: baseline;
    column-gap: 0.8cqw;
    padding: 0.7cqw 1cqw 0.8cqw;
    border: 1px solid var(--on-ink-14);
    border-left: 0.4cqw solid var(--iron-paint);
    border-radius: 2px;
    background: var(--on-ink-05);
    transition:
      border-color 300ms ease,
      background-color 300ms ease;
  }
  .iron-player.iron-on {
    border-color: var(--accent-on-dark);
    border-left-color: var(--iron-paint);
    background: var(--on-ink-12);
  }
  .iron-player.iron-gone {
    opacity: 0.5;
  }
  .iron-chip {
    grid-area: chip;
    width: 1.3cqw;
    height: 1.3cqw;
    border-radius: 100px;
    background: var(--iron-paint);
    align-self: center;
  }
  .iron-pname {
    grid-area: name;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.7cqw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .iron-pscore {
    grid-area: score;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2cqw;
    font-variant-numeric: tabular-nums;
  }
  .iron-pstats {
    grid-area: stats;
    font-family: var(--font-body);
    font-size: 1.05cqw;
    white-space: nowrap;
    color: var(--on-ink-70);
  }
  .iron-hot {
    color: var(--accent-on-dark);
  }
  .iron-quiet {
    color: var(--on-ink-45);
  }
  .iron-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 0.25cqw;
    background: var(--on-ink-08);
  }
  .iron-bar span {
    display: block;
    height: 100%;
    background: var(--accent-on-dark);
    transition: width 500ms linear;
  }
  .iron-market {
    display: grid;
    gap: 0.6cqw;
  }
  .iron-cards {
    --iron-card-w: 3.6cqw;
    display: grid;
    grid-template-columns: repeat(5, var(--iron-card-w));
    gap: 0.45cqw;
  }
  .iron-empty {
    width: var(--iron-card-w);
    aspect-ratio: 2 / 3;
    border: 1px dashed var(--on-ink-16);
    border-radius: 2px;
  }
  .iron-deckline {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.9cqw;
    color: var(--on-ink-55);
  }
  .iron-last {
    margin: 0;
    padding: 0.8cqw 1cqw;
    border-left: 2px solid var(--accent-on-dark);
    background: var(--on-ink-05);
    font-size: 1.45cqw;
    line-height: 1.3;
    color: var(--chrome-ink);
  }
</style>
