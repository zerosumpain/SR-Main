<script lang="ts">
  // The Azul table on the TV: the factories in a ring round the centre, a
  // board for each player either side, whose turn it is and their clock, and
  // the last few things that happened. Drawn from the room's `toScreen` wire
  // alone; the phones are where the moves are made.
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import AzulBoard from './AzulBoard.svelte';
  import AzulTile from './AzulTile.svelte';
  import { COLOURS, receive, send, type AzulRoom } from './motion';

  let { room, skewMs = 0 }: { room: AzulRoom; skewMs?: number } = $props();

  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(t);
  });

  const serverNow = $derived(now + skewMs);
  const seated = $derived([...room.players].filter((p) => p.seat !== null).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0)));
  const leftSide = $derived(seated.slice(0, Math.ceil(seated.length / 2)));
  const rightSide = $derived(seated.slice(Math.ceil(seated.length / 2)));
  const mover = $derived(room.players.find((p) => p.id === room.turnId) ?? null);
  const fresh = $derived(
    new Set<number>(room.phase === 'playing' && room.last ? [...room.last.tiles, ...(room.last.tookFirst ? [100] : [])] : []),
  );
  const remaining = $derived.by(() => {
    if (room.phase !== 'playing' || room.phaseEndsAt === null || room.turnStartedAt === null) return null;
    const total = room.phaseEndsAt - room.turnStartedAt;
    return total > 0 ? Math.max(0, Math.min(1, (room.phaseEndsAt - serverNow) / total)) : null;
  });
  const secondsLeft = $derived(room.phaseEndsAt === null ? null : Math.max(0, Math.ceil((room.phaseEndsAt - serverNow) / 1000)));
  const order = (c: string) => COLOURS.indexOf(c as (typeof COLOURS)[number]);
  const centre = $derived([...room.centre].sort((a, b) => order(a.c) - order(b.c) || a.id - b.id));
  const standingOf = (id: string) => room.standings?.find((s) => s.id === id) ?? null;
  const scoredOf = (id: string) => (room.phase === 'scoring' ? (room.roundScores?.find((s) => s.id === id) ?? null) : null);

  /** Factory centres round the ring, as percentages of the ring's square; the first at the top. */
  const spots = $derived(
    room.factories.map((_, i, all) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / all.length;
      return { x: 50 + 40 * Math.cos(a), y: 50 + 40 * Math.sin(a) };
    }),
  );
  const lastSource = $derived(room.phase === 'playing' ? (room.last?.source ?? null) : null);
  const joined = $derived(room.players.filter((p) => p.status === 'joined'));
  const invited = $derived(room.players.filter((p) => p.status === 'invited'));

  const headline = $derived.by(() => {
    switch (room.phase) {
      case 'lobby':
        return 'Waiting for the host to start';
      case 'countdown':
        return 'Shuffling the bag';
      case 'playing':
        return mover ? `${mover.name} to play` : 'Playing';
      case 'scoring':
        return `Round ${room.round} — tiling the walls`;
      case 'finished': {
        const names = room.winnerIds.map((id) => room.players.find((p) => p.id === id)?.name ?? '?');
        return names.length > 1 ? `${names.join(' and ')} share it` : names.length ? `${names[0]} wins` : 'Game over';
      }
      default:
        return 'This game has ended';
    }
  });
  const log = $derived(room.log.slice(-3).reverse());
</script>

<div class="azul" class:solo={seated.length <= 2}>
  <header class="top">
    <span class="brand"><span class="mark">sr.</span> azul</span>
    {#key headline}
      <h1 in:fly={{ y: -12, duration: 380 }}>{headline}</h1>
    {/key}
    <span class="meta">
      {#if room.round > 0}<span>Round {room.round}</span>{/if}
      {#if room.lastRound && room.phase !== 'finished'}<span class="hot">Last round</span>{/if}
      {#if room.phase === 'playing' && secondsLeft !== null && room.deadlineHours === null}<span class="tabnum">{secondsLeft}s</span>{/if}
      {#if room.round > 0}<span>bag {room.bag}</span>{/if}
    </span>
  </header>

  <div class="body">
    <div class="side">
      {#each leftSide as p (p.id)}
        <AzulBoard
          player={p}
          active={p.id === room.turnId}
          {fresh}
          scored={scoredOf(p.id)}
          standing={standingOf(p.id)}
          remaining={p.id === room.turnId ? remaining : null}
        />
      {/each}
    </div>

    <div class="centrepiece">
      {#if room.phase === 'lobby' || room.phase === 'countdown'}
        <div class="waiting" in:fade>
          <p class="sr-kicker">At the table</p>
          <ul>
            {#each joined as p (p.id)}
              <li in:fly={{ y: 16, duration: 360 }} animate:flip={{ duration: 300 }}>{p.name}{p.isHost ? ' · host' : ''}</li>
            {/each}
            {#each invited as p (p.id)}
              <li class="asked" animate:flip={{ duration: 300 }}>{p.name} · asked</li>
            {/each}
          </ul>
          {#if room.phase === 'countdown'}
            <p class="count">{secondsLeft ?? ''}</p>
          {/if}
        </div>
      {:else}
        <div class="wheel" class:done={room.phase === 'finished'}>
          {#each room.factories as f, i (i)}
            <div class="factory" class:last={lastSource === i} class:empty={!f.length} style:left="{spots[i]?.x}%" style:top="{spots[i]?.y}%">
              <span class="fnum">{i + 1}</span>
              <div class="ftiles">
                {#each f as t, k (t.id)}
                  <span class="ft" in:receive={{ key: t.id, delay: i * 60 + k * 25 }} out:send={{ key: t.id }}>
                    <AzulTile c={t.c} />
                  </span>
                {/each}
              </div>
            </div>
          {/each}
          <div class="pool" class:last={lastSource === 'centre'}>
            {#if room.firstInCentre}
              <span class="pt" in:receive={{ key: 100 }} out:send={{ key: 100 }}><AzulTile c="first" /></span>
            {/if}
            {#each centre as t (t.id)}
              <span class="pt" in:receive={{ key: t.id }} out:send={{ key: t.id }} animate:flip={{ duration: 420 }}>
                <AzulTile c={t.c} />
              </span>
            {/each}
          </div>
        </div>
      {/if}

      {#if room.phase === 'finished' && room.standings}
        <div class="final" in:fly={{ y: 30, duration: 520 }}>
          <p class="sr-kicker">Final scores</p>
          <ol>
            {#each room.standings as s (s.id)}
              <li class:won={s.result === 'won' || s.result === 'drew'}>
                <span class="place">{s.place}</span>
                <span class="who">{s.name}</span>
                <span class="pts">{s.score}</span>
              </li>
            {/each}
          </ol>
          <p class="note">The host can start another from their phone.</p>
        </div>
      {/if}
    </div>

    <div class="side">
      {#each rightSide as p (p.id)}
        <AzulBoard
          player={p}
          active={p.id === room.turnId}
          {fresh}
          scored={scoredOf(p.id)}
          standing={standingOf(p.id)}
          remaining={p.id === room.turnId ? remaining : null}
        />
      {/each}
    </div>
  </div>

  <footer class="log" aria-live="polite">
    {#each log as e (e.n)}
      <span class="entry" in:fly={{ x: -20, duration: 360 }}>{e.text}{e.auto ? ' (out of time)' : ''}</span>
    {/each}
  </footer>
</div>

<style>
  .azul {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    padding: 1.6cqw 2cqw 1.2cqw;
    gap: 1cqw;
    font-family: var(--font-body);
  }
  .top {
    display: flex;
    align-items: baseline;
    gap: 1.6cqw;
    border-bottom: 1px solid var(--on-ink-14);
    padding-bottom: 0.9cqw;
  }
  .brand {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
    white-space: nowrap;
  }
  .mark {
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
  .meta {
    display: flex;
    gap: 1.2cqw;
    font-family: var(--font-mono);
    font-size: 1cqw;
    color: var(--on-ink-55);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }
  .meta .hot {
    color: var(--accent-on-dark);
  }
  .tabnum {
    text-transform: none;
    font-variant-numeric: tabular-nums;
    color: var(--chrome-ink);
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 36cqw minmax(0, 1fr);
    gap: 1.6cqw;
    min-height: 0;
  }
  .side {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1.1cqw;
    min-width: 0;
  }
  /* Two boards a side for three or four players; one, larger, for two. */
  .side :global(.board) {
    --t: 1.85cqw;
  }
  .solo .side :global(.board) {
    --t: 2.15cqw;
  }
  .centrepiece {
    position: relative;
    display: grid;
    place-items: center;
  }
  .wheel {
    position: relative;
    width: 35cqw;
    height: 35cqw;
  }
  .wheel.done {
    opacity: 0.15;
    transition: opacity 600ms ease;
  }
  .factory {
    position: absolute;
    width: 6.8cqw;
    height: 6.8cqw;
    margin: -3.4cqw 0 0 -3.4cqw;
    border-radius: 100px;
    background: var(--on-ink-08);
    border: 1px solid var(--on-ink-16);
    display: grid;
    place-items: center;
    transition:
      border-color 300ms ease,
      background-color 300ms ease;
  }
  .factory.empty {
    background: var(--on-ink-05);
    border-style: dashed;
  }
  .factory.last {
    border-color: var(--accent-on-dark);
  }
  .fnum {
    position: absolute;
    top: -0.2cqw;
    left: 0.2cqw;
    font-family: var(--font-mono);
    font-size: 0.8cqw;
    color: var(--on-ink-45);
  }
  .ftiles {
    --t: 2.1cqw;
    display: grid;
    grid-template-columns: repeat(2, var(--t));
    gap: 0.3cqw;
  }
  .ft,
  .pt {
    display: block;
  }
  .pool {
    --t: 1.95cqw;
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 17cqw;
    min-height: 6cqw;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-content: center;
    gap: 0.3cqw;
    padding: 0.8cqw;
    border-radius: 4px;
    border: 1px dashed var(--on-ink-16);
    transition: border-color 300ms ease;
  }
  .pool.last {
    border-color: var(--accent-on-dark);
  }
  .waiting {
    text-align: center;
  }
  .waiting ul {
    list-style: none;
    margin: 1cqw 0 0;
    padding: 0;
    display: grid;
    gap: 0.6cqw;
  }
  .waiting li {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.4cqw;
  }
  .waiting li.asked {
    color: var(--on-ink-45);
  }
  .count {
    margin: 1.4cqw 0 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 7cqw;
    color: var(--accent-on-dark);
  }
  .sr-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .final {
    position: absolute;
    inset: 0 1cqw;
    height: fit-content;
    margin: auto 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1cqw;
    padding: 2cqw 2.4cqw;
    background: var(--chrome-bg);
    border: 1px solid var(--good-on-dark);
    border-radius: 4px;
  }
  .final ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6cqw;
  }
  .final li {
    display: grid;
    grid-template-columns: 2.4cqw 1fr auto;
    align-items: baseline;
    gap: 1cqw;
    font-size: 2cqw;
  }
  .final li.won {
    color: var(--good-on-dark);
  }
  .place {
    font-family: var(--font-mono);
    font-size: 1.2cqw;
    color: var(--on-ink-55);
  }
  .who {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
  }
  .pts {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-variant-numeric: tabular-nums;
  }
  .note {
    margin: 0.6cqw 0 0;
    font-size: 1.1cqw;
    color: var(--on-ink-55);
  }
  .log {
    display: flex;
    gap: 2cqw;
    min-height: 1.8cqw;
    font-size: 1.05cqw;
    color: var(--on-ink-55);
    overflow: hidden;
    white-space: nowrap;
  }
  .log .entry:first-child {
    color: var(--on-ink-80);
  }
</style>
