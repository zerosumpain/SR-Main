<script lang="ts">
  // Codenames on the TV: the 25 cards large in the middle, each team's side
  // either way — agents still to find as pips, its spymaster and operatives,
  // the clues it has had — and the clue in play over the grid with the
  // guesses left. Drawn from the room's `toScreen` wire, which never holds the
  // key until the game is over: everything here is what an operative sees.
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import CodenamesCard from './CodenamesCard.svelte';
  import type { WireRoom } from '$lib/games/codenames';

  type Team = 'red' | 'blue';

  let { room, skewMs = 0 }: { room: WireRoom; skewMs?: number } = $props();

  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(t);
  });

  const serverNow = $derived(now + skewMs);
  const coop = $derived(room.mode === 'coop');
  const playing = $derived(room.phase === 'clue' || room.phase === 'guess');
  const dealt = $derived(room.cards.length > 0 && room.phase !== 'lobby' && room.phase !== 'countdown');
  const nameOf = (id: string | null) => (id === 'auto' ? 'blue' : (room.players.find((p) => p.id === id)?.name ?? null));
  const teamName = (t: Team) => (t === 'red' ? 'Red' : 'Blue');
  const teamInfo = (t: Team) => room.teams.find((x) => x.team === t) ?? { team: t, agents: 0, left: 0, spymasterId: null };
  const members = (t: Team) => room.players.filter((p) => p.status === 'joined' && p.team === t);
  const cluesOf = (t: Team) => room.clues.filter((c) => c.team === t).slice(-6).reverse();

  const total = $derived(room.phase === 'clue' ? room.clueMs : room.guessMs);
  const left = $derived.by(() => {
    if (!playing || room.phaseEndsAt === null) return null;
    return Math.max(0, Math.min(1, (room.phaseEndsAt - serverNow) / total));
  });
  const secondsLeft = $derived(room.phaseEndsAt === null ? null : Math.max(0, Math.ceil((room.phaseEndsAt - serverNow) / 1000)));

  const headline = $derived.by(() => {
    const t = teamName(room.turnTeam);
    switch (room.phase) {
      case 'lobby':
        return coop ? 'Co-op: one team against the clock' : 'Picking teams';
      case 'countdown':
        return 'Dealing the cards';
      case 'clue': {
        const s = nameOf(teamInfo(room.turnTeam).spymasterId);
        return coop ? `${s ?? 'The spymaster'} is thinking of a clue` : `${t}’s spymaster${s ? `, ${s},` : ''} is thinking`;
      }
      case 'guess':
        return coop ? 'Guessing' : `${t} are guessing`;
      case 'finished': {
        const r = room.result;
        if (!r) return 'Game over';
        if (coop) return r.winner ? 'You found them all' : r.reason === 'assassin' ? 'The assassin got you' : 'The other side got there first';
        const w = r.winner ? teamName(r.winner) : '';
        const loser = r.winner === 'red' ? 'Blue' : 'Red';
        return r.reason === 'assassin' ? `${loser} touched the assassin — ${w} win` : r.reason === 'left' ? `${w} win` : `${w} find every agent`;
      }
      default:
        return 'This game has ended';
    }
  });

  const lastCard = $derived(room.last?.card ?? null);
  const sides = $derived<Team[]>(['red', 'blue']);
  const lobbyRows = $derived(
    room.players.filter((p) => p.status === 'joined' || p.status === 'invited').map((p) => ({ ...p, side: p.team ?? 'any' })),
  );
</script>

<div class="cn" class:red-turn={playing && room.turnTeam === 'red'} class:blue-turn={playing && room.turnTeam === 'blue'}>
  <header class="top">
    <span class="gb-brand"><span class="mark">sr.</span> codenames</span>
    {#key headline}
      <h1 in:fly={{ y: -12, duration: 380 }}>{headline}</h1>
    {/key}
    <span class="meta">
      {#if coop && dealt}<span>Co-op</span>{/if}
      {#if playing && secondsLeft !== null}<span class="tabnum">{secondsLeft}s</span>{/if}
    </span>
  </header>

  <div class="body" class:open={!dealt}>
    {#each dealt ? sides : [] as t (t)}
      {@const info = teamInfo(t)}
      <aside class="side {t}" class:on={playing && room.turnTeam === t} class:won={room.result?.winner === t} style:order={t === 'red' ? 0 : 2}>
        <p class="tname">{teamName(t)}</p>
        {#if dealt}
          <p class="left"><span class="n">{info.left}</span> <span class="of">of {info.agents} to find</span></p>
          <div class="pips" aria-hidden="true">
            {#each Array.from({ length: info.agents }, (_, i) => i) as i (i)}
              <span class="pip" class:found={i >= info.left}></span>
            {/each}
          </div>
        {/if}
        {#if coop && t === 'blue'}
          <p class="note">Nobody plays blue: one of its agents turns itself over at the end of each of your turns.</p>
        {:else}
          <ul class="who">
            {#each members(t) as p (p.id)}
              <li animate:flip={{ duration: 300 }} class:spy={p.spymaster && dealt}>
                {p.name}{#if p.spymaster && dealt}<span class="role">spymaster</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if cluesOf(t).length}
          <ol class="history">
            {#each cluesOf(t) as c (c.at)}
              <li in:fly={{ y: -10, duration: 300 }}>
                <span class="cw">{c.word}</span>
                <span class="cc">{c.count}</span>
                <span class="hits">
                  {#each c.cards as i (i)}
                    <span class="hit {room.cards[i]?.kind ?? ''}"></span>
                  {/each}
                </span>
              </li>
            {/each}
          </ol>
        {/if}
      </aside>
    {/each}

    <main class="middle" style:order="1">
      {#if room.phase === 'lobby' || room.phase === 'countdown'}
        <div class="lobby" in:fade>
          {#if room.phase === 'countdown'}
            {#key secondsLeft}
              <p class="count" in:scale={{ start: 1.6, duration: 600, easing: cubicOut }}>{secondsLeft ?? ''}</p>
            {/key}
          {:else}
            <p class="kicker">{coop ? 'Two or three play together' : 'Pick a side on your phone'}</p>
            <div class="picks">
              {#each ['red', 'any', 'blue'] as side (side)}
                <div class="pick {side}">
                  <p class="ph">{side === 'any' ? 'Anywhere' : side === 'red' ? 'Red' : 'Blue'}</p>
                  {#each lobbyRows.filter((p) => p.side === side) as p (p.id)}
                    <p class="pn" class:asked={p.status === 'invited'} in:fly={{ y: 12, duration: 300 }}>
                      {p.name}{p.spymaster ? ' · clues' : ''}{p.status === 'invited' ? ' · asked' : ''}
                    </p>
                  {/each}
                </div>
              {/each}
            </div>
            <p class="note">
              {coop
                ? 'One of you gives one-word clues; the rest find the nine red agents before the other side finds its eight.'
                : 'Each team has a spymaster who sees which words are theirs, and gives one word and a number.'}
            </p>
          {/if}
        </div>
      {:else}
        <div class="cluebar">
          {#if room.clue}
            {#key room.clue.at}
              <div class="clue {room.clue.team}" in:fly={{ y: -20, duration: 420, easing: cubicOut }}>
                <span class="cword">{room.clue.word}</span>
                <span class="ccount">{room.clue.count}</span>
                <span class="guesses" aria-label="{room.clue.guessesLeft} guesses left">
                  {#each Array.from({ length: room.clue.count + 1 }, (_, i) => i) as i (i)}
                    <span class="g" class:used={i < room.clue.cards.length}></span>
                  {/each}
                </span>
              </div>
            {/key}
          {:else if room.phase === 'finished' && room.result}
            <div class="clue {room.result.winner ?? 'lost'}" in:scale={{ start: 0.8, duration: 520, easing: cubicOut }}>
              <span class="cword">{room.result.winner ? `${teamName(room.result.winner)} win` : 'Lost'}</span>
            </div>
          {:else if room.phase === 'clue'}
            <div class="clue waiting {room.turnTeam}" in:fade>
              <span class="dots">{#each [0, 1, 2] as i (i)}<span style:animation-delay="{i * 180}ms"></span>{/each}</span>
              <span class="wait">Waiting for a clue</span>
            </div>
          {/if}
          {#if playing}
            <div class="clock" aria-hidden="true">
              <span class="drain {room.turnTeam}" class:low={left !== null && left < 0.2} style:transform="scaleX({left ?? 0})"></span>
            </div>
          {/if}
        </div>
        <div class="grid" class:over={room.phase === 'finished'}>
          {#each room.cards as c (c.i)}
            <div class="slot" in:scale={{ start: 0.85, duration: 460, delay: c.i * 28, easing: cubicOut }}>
              <CodenamesCard
                word={c.word}
                kind={c.kind}
                keyKind={c.kind === null && room.key ? room.key[c.i] : null}
                by={c.by === 'auto' ? null : nameOf(c.by)}
                fresh={lastCard === c.i && c.kind !== null}
              />
            </div>
          {/each}
        </div>
      {/if}
    </main>
  </div>
</div>

<style>
  .cn {
    --red: #b4472c;
    --blue: #1f4f8f;
    --red-on-dark: #e0795c;
    --blue-on-dark: #7aa6e0;
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    padding: 1.6cqw 2cqw 1.6cqw;
    gap: 1.2cqw;
    font-family: var(--font-body);
  }
  .top {
    display: flex;
    align-items: baseline;
    gap: 1.6cqw;
    border-bottom: 1px solid var(--on-ink-14);
    padding-bottom: 0.9cqw;
  }
  .gb-brand {
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
  .red-turn h1 {
    color: var(--red-on-dark);
  }
  .blue-turn h1 {
    color: var(--blue-on-dark);
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
  .tabnum {
    text-transform: none;
    font-variant-numeric: tabular-nums;
    font-size: 1.8cqw;
    color: var(--chrome-ink);
  }
  .body {
    display: grid;
    grid-template-columns: 19cqw minmax(0, 1fr) 19cqw;
    gap: 1.8cqw;
    min-height: 0;
  }
  .body.open {
    grid-template-columns: minmax(0, 1fr);
  }
  .body.open .middle {
    grid-template-rows: minmax(0, 1fr);
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 0.9cqw;
    padding: 1.4cqw 1.4cqw;
    border: 1px solid var(--on-ink-14);
    border-top: 0.45cqw solid var(--team);
    border-radius: 4px;
    background: var(--on-ink-05);
    opacity: 0.72;
    min-height: 0;
    overflow: hidden;
    transition:
      opacity 400ms ease,
      border-color 400ms ease,
      background-color 400ms ease;
  }
  .side.red {
    --team: var(--red);
    --team-on-dark: var(--red-on-dark);
  }
  .side.blue {
    --team: var(--blue);
    --team-on-dark: var(--blue-on-dark);
  }
  .side.on,
  .side.won {
    opacity: 1;
    border-color: var(--team);
    background: var(--on-ink-08);
  }
  .tname {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.6cqw;
    color: var(--team-on-dark);
    line-height: 1;
  }
  .left {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 0.6cqw;
  }
  .left .n {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 4.4cqw;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .left .of {
    font-size: 1.1cqw;
    color: var(--on-ink-55);
  }
  .pips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35cqw;
  }
  .pip {
    width: 1.3cqw;
    height: 1.3cqw;
    border-radius: 2px;
    background: var(--team);
    transition:
      background-color 500ms ease,
      transform 500ms cubic-bezier(0.2, 0.7, 0.2, 1.4);
  }
  .pip.found {
    background: transparent;
    outline: 1px solid var(--on-ink-30);
    outline-offset: -1px;
    transform: scale(0.8);
  }
  .who {
    list-style: none;
    margin: 0.4cqw 0 0;
    padding: 0;
    display: grid;
    gap: 0.35cqw;
  }
  .who li {
    font-size: 1.45cqw;
    color: var(--on-ink-80);
  }
  .who li.spy {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    color: var(--chrome-ink);
  }
  .role {
    margin-left: 0.6cqw;
    font-family: var(--font-mono);
    font-weight: 400;
    font-size: 0.85cqw;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--team-on-dark);
  }
  .history {
    list-style: none;
    margin: auto 0 0;
    padding: 0.8cqw 0 0;
    border-top: 1px solid var(--on-ink-14);
    display: grid;
    gap: 0.45cqw;
  }
  .history li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.6cqw;
  }
  .cw {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.3cqw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cc {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    color: var(--on-ink-55);
  }
  .hits {
    display: flex;
    gap: 0.2cqw;
  }
  .hit {
    width: 0.8cqw;
    height: 0.8cqw;
    border-radius: 100px;
    background: #a99c88;
  }
  .hit.red {
    background: var(--red);
  }
  .hit.blue {
    background: var(--blue);
  }
  .hit.assassin {
    background: var(--chrome-ink);
  }
  .note {
    margin: 0;
    font-size: 1.2cqw;
    line-height: 1.35;
    color: var(--on-ink-55);
  }
  .middle {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 1cqw;
    min-width: 0;
    min-height: 0;
  }
  .cluebar {
    display: grid;
    gap: 0.6cqw;
    min-height: 5.6cqw;
    align-content: end;
  }
  .clue {
    justify-self: center;
    display: flex;
    align-items: center;
    gap: 1.4cqw;
    padding: 0.7cqw 1.8cqw;
    border-radius: 4px;
    background: var(--team-face, var(--on-ink-08));
  }
  .clue.red {
    --team-face: var(--red);
  }
  .clue.blue {
    --team-face: var(--blue);
  }
  .clue.lost {
    --team-face: var(--on-ink-16);
  }
  .clue.waiting {
    background: transparent;
    border: 1px dashed var(--on-ink-30);
  }
  .cword {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3.2cqw;
    letter-spacing: 0.04em;
    line-height: 1;
    color: #f6efe3;
  }
  .ccount {
    display: grid;
    place-items: center;
    width: 3.6cqw;
    height: 3.6cqw;
    border-radius: 100px;
    background: rgba(0, 0, 0, 0.25);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.2cqw;
    color: #f6efe3;
  }
  .guesses {
    display: flex;
    gap: 0.35cqw;
  }
  .g {
    width: 0.9cqw;
    height: 0.9cqw;
    border-radius: 100px;
    background: #f6efe3;
    transition:
      opacity 300ms ease,
      transform 300ms ease;
  }
  .g.used {
    opacity: 0.25;
    transform: scale(0.75);
  }
  .wait {
    font-size: 1.6cqw;
    color: var(--on-ink-80);
  }
  .dots {
    display: flex;
    gap: 0.5cqw;
  }
  .dots span {
    width: 0.8cqw;
    height: 0.8cqw;
    border-radius: 100px;
    background: var(--on-ink-55);
    animation: bob 1.1s ease-in-out infinite;
  }
  .clue.waiting.red .dots span {
    background: var(--red-on-dark);
  }
  .clue.waiting.blue .dots span {
    background: var(--blue-on-dark);
  }
  .clock {
    height: 0.35cqw;
    border-radius: 100px;
    background: var(--on-ink-08);
    overflow: hidden;
  }
  .drain {
    display: block;
    height: 100%;
    transform-origin: left center;
    transition: transform 250ms linear;
  }
  .drain.red {
    background: var(--red-on-dark);
  }
  .drain.blue {
    background: var(--blue-on-dark);
  }
  .drain.low {
    background: var(--error);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    grid-template-rows: repeat(5, minmax(0, 1fr));
    gap: 0.8cqw;
    min-height: 0;
  }
  .slot {
    display: grid;
    min-height: 0;
  }
  .slot > :global(.cncard) {
    height: 100%;
  }
  .lobby {
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 1.6cqw;
    text-align: center;
  }
  .kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .picks {
    display: grid;
    grid-template-columns: repeat(3, 13cqw);
    gap: 1.2cqw;
  }
  .pick {
    padding: 1cqw;
    border-radius: 4px;
    border: 1px solid var(--on-ink-14);
    border-top: 0.4cqw solid var(--on-ink-30);
    min-height: 12cqw;
  }
  .pick.red {
    border-top-color: var(--red);
  }
  .pick.blue {
    border-top-color: var(--blue);
  }
  .ph {
    margin: 0 0 0.6cqw;
    font-family: var(--font-mono);
    font-size: 1cqw;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .pn {
    margin: 0.3cqw 0 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.7cqw;
  }
  .pn.asked {
    color: var(--on-ink-45);
  }
  .lobby .note {
    max-width: 44cqw;
    font-size: 1.4cqw;
  }
  .count {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 16cqw;
    color: var(--accent-on-dark);
  }
  @keyframes bob {
    0%,
    100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    50% {
      transform: translateY(-0.6cqw);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dots span {
      animation: none;
    }
    .drain {
      transition: none;
    }
  }
</style>
