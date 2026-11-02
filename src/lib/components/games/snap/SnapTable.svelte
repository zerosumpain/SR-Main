<script lang="ts">
  // Snap Happy on the TV. The TV is the only screen that holds the run: it
  // names the target first, then flicks through the dealt pictures at the
  // times the server set (on the server's clock), one huge picture at a time,
  // with the target in a corner and each name lighting up as they snap. At the
  // result it shows who got it and how fast; at the finish, the standings.
  // Drawn from the room's `toScreen` wire alone.
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { STING, hostLine } from '$lib/games/kelly';
  import type { Picture, ScreenRoom, Snap } from '$lib/games/snap-happy';
  import SnapPicture from './SnapPicture.svelte';

  let { room, skewMs = 0 }: { room: ScreenRoom; skewMs?: number } = $props();

  // Flips are as quick as 650 ms, so the clock runs every frame, not every quarter-second.
  let now = $state(Date.now());
  onMount(() => {
    let raf = 0; // a plain handle, never reactive (svelte5-pitfalls §1)
    const tick = () => {
      now = Date.now();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const LOBBY_PICS: Picture[] = ['engine', 'teapot', 'bus', 'biscuit'];
  const serverNow = $derived(now + skewMs);
  const r = $derived(room.round);
  const armed = $derived(room.phase === 'armed' && !!r);
  const intro = $derived(armed && !!r && serverNow < r.startsAt);
  /** The flip on screen: the latest whose time has come. */
  const flipIndex = $derived.by(() => {
    if (!armed || !r) return -1;
    let at = -1;
    for (let i = 0; i < r.flips.length; i++) if (r.flips[i].at <= serverNow) at = i;
    return at;
  });
  const shown = $derived(r && flipIndex >= 0 ? r.flips[flipIndex].pic : null);
  const secondsLeft = $derived(room.phaseEndsAt === null ? null : Math.max(0, Math.ceil((room.phaseEndsAt - serverNow) / 1000)));

  const playing = $derived(room.players.filter((p) => p.status === 'joined'));
  const snapped = $derived(new Set(r?.snappedIds ?? []));
  const board = $derived([...playing].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)));
  const nameOf = (id: string) => room.players.find((p) => p.id === id)?.name ?? room.standings?.find((s) => s.id === id)?.name ?? '?';
  const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

  /** The result, best first: right snaps by speed, then too slow, then too early, then nobody. */
  const ranked = $derived.by(() => {
    if (room.phase !== 'result' || !r?.snaps) return [] as { id: string; snap: Snap | null }[];
    const order = (s: Snap) => (s.reactionMs !== null ? s.reactionMs : s.early ? 1e9 : 1e8);
    const list: { id: string; snap: Snap | null }[] = [...r.snaps].sort((a, b) => order(a) - order(b)).map((s) => ({ id: s.playerId, snap: s }));
    for (const p of playing) if (!r.snaps.some((s) => s.playerId === p.id)) list.push({ id: p.id, snap: null });
    return list;
  });
  const gained = $derived(new Map((room.phase === 'result' ? (r?.snaps ?? []) : []).map((s) => [s.playerId, s.points])));
  const verdict = (snap: Snap | null) => {
    if (!snap) return 'No snap';
    if (snap.early) return 'Too early';
    if (snap.reactionMs === null) return 'Too slow';
    return seconds(snap.reactionMs);
  };

  const seed = $derived([...room.id].reduce((n, c) => n + c.charCodeAt(0), 0));
  const winnerLine = $derived.by(() => {
    const top = room.standings?.[0]?.score ?? 0;
    const names = room.winnerIds.map(nameOf);
    if (names.length > 1) return `${names.join(' and ')} draw on ${top}`;
    if (names.length === 1) return `${names[0]} wins with ${top}`;
    return 'Nobody scored';
  });
  const finishLine = $derived.by(() => {
    const names = room.winnerIds.map(nameOf);
    if (names.length > 1) return hostLine('draw', seed);
    if (names.length === 1) return hostLine('winner', seed, names[0]);
    return hostLine('nobody', seed);
  });
  const podium = $derived(room.standings?.slice(0, 3) ?? []);

  const headline = $derived.by(() => {
    switch (room.phase) {
      case 'lobby':
        return 'Waiting for the host';
      case 'countdown':
        return 'Get ready';
      case 'armed':
        return r ? `Snap on ${r.targetLabel}` : 'Get ready';
      case 'result':
        return r ? `It was ${r.targetLabel}` : 'Round over';
      case 'finished':
        return winnerLine;
      default:
        return 'This game has ended';
    }
  });
</script>

<div class="snap-root">
  <header class="snap-top">
    <span class="snap-brand"><span class="snap-mark">sr.</span> Snap Happy</span>
    {#key headline}
      <h1 class="snap-headline" in:fly={{ y: -12, duration: 340 }}>{headline}</h1>
    {/key}
    <span class="snap-meta">
      {#if r && room.phase !== 'finished'}<span>Round {r.number} of {room.rounds}</span>{/if}
      <span>{room.difficulty}</span>
    </span>
  </header>

  <div class="snap-body">
    <main class="snap-main">
      {#if room.phase === 'armed' && r}
        {#if intro}
          <div class="snap-intro" in:fade={{ duration: 260 }}>
            <p class="snap-kicker snap-kicker-accent">Snap on</p>
            <p class="snap-target-name">{r.targetLabel}</p>
            <div class="snap-intro-pic" in:scale={{ start: 0.7, duration: 420, easing: cubicOut }}>
              <SnapPicture pic={r.target} size="100%" />
            </div>
            <p class="snap-note">Watch for it, then snap on your phone</p>
          </div>
        {:else}
          <div class="snap-stage">
            {#key flipIndex}
              <div class="snap-flip" in:scale={{ start: 0.82, opacity: 0.2, duration: 130, easing: cubicOut }}>
                {#if shown}<SnapPicture pic={shown} size="100%" />{/if}
              </div>
            {/key}
            <div class="snap-remind">
              <SnapPicture pic={r.target} size="100%" />
              <span>Snap on</span>
            </div>
          </div>
        {/if}
      {:else if room.phase === 'result' && r}
        <div class="snap-result" in:fade={{ duration: 300 }}>
          <div class="snap-result-pic">
            <SnapPicture pic={r.target} size="100%" />
          </div>
          <ol class="snap-ranked">
            {#each ranked as row, i (row.id)}
              <li
                class="snap-rank"
                class:snap-rank-win={!!row.snap && row.snap.points > 0}
                class:snap-rank-bad={!!row.snap && row.snap.points < 0}
                in:fly={{ x: 30, duration: 380, delay: 120 + i * 90, easing: cubicOut }}
              >
                <span class="snap-rname">{nameOf(row.id)}</span>
                <span class="snap-rtime">{verdict(row.snap)}</span>
                <span class="snap-rpts">{signed(row.snap?.points ?? 0)}</span>
              </li>
            {/each}
          </ol>
        </div>
      {:else if room.phase === 'countdown'}
        <div class="snap-ready">
          <p class="snap-ready-label">Get ready</p>
          {#key secondsLeft}
            <span class="snap-ready-num" in:scale={{ start: 1.6, duration: 600, easing: cubicOut }}>{secondsLeft || ''}</span>
          {/key}
          <p class="snap-note">Fastest right snap wins 3. Snap on the wrong picture and lose 1.</p>
        </div>
      {:else if room.phase === 'finished'}
        <div class="snap-finish" in:fade={{ duration: 420 }}>
          <p class="snap-finish-line">{finishLine}</p>
          {#if podium.length}
            <ol class="snap-podium">
              {#each podium as s, i (s.id)}
                <li
                  class="snap-step snap-step-{i + 1}"
                  class:snap-step-win={room.winnerIds.includes(s.id)}
                  in:fly={{ y: 40, duration: 520, delay: 200 + (2 - i) * 180, easing: cubicOut }}
                >
                  <span class="snap-step-name">{s.name}</span>
                  <span class="snap-step-score">{s.score}</span>
                  <span class="snap-step-block">
                    <span class="snap-step-place">{i + 1}</span>
                    {#if s.bestMs !== null}<span class="snap-step-best">Best {seconds(s.bestMs)}</span>{/if}
                  </span>
                </li>
              {/each}
            </ol>
          {:else}
            <p class="snap-note">Nobody played</p>
          {/if}
        </div>
      {:else if room.phase === 'lobby'}
        <div class="snap-ready">
          <div class="snap-lobby-pics" aria-hidden="true">
            {#each LOBBY_PICS as pic (pic)}
              <SnapPicture {pic} size="100%" />
            {/each}
          </div>
          <p class="snap-ready-label">Watch the TV. Snap on your phone.</p>
          <p class="snap-note">{room.rounds} rounds. The fastest right snap scores most.</p>
        </div>
      {:else}
        <div class="snap-ready">
          <p class="snap-ready-label">This game has ended</p>
        </div>
      {/if}
    </main>

    <aside class="snap-side">
      <p class="snap-kicker">
        {room.phase === 'lobby' ? 'At the table' : room.phase === 'armed' && !intro ? 'Snapped' : room.phase === 'finished' ? 'Standings' : 'Scores'}
      </p>
      <div class="snap-players">
        {#if room.phase === 'finished'}
          {#each room.standings ?? [] as s, i (s.id)}
            <div class="snap-player" class:snap-player-lead={room.winnerIds.includes(s.id)}>
              <span class="snap-pname">{i + 1}. {s.name}</span>
              <span class="snap-pgain">{s.wrong ? `${s.wrong} early` : ''}</span>
              <span class="snap-pscore">{s.score}</span>
            </div>
          {/each}
          {#if !room.standings?.length}
            <p class="snap-note">No scores</p>
          {/if}
        {:else}
          {#each board as p (p.id)}
            {@const g = gained.get(p.id)}
            <div
              class="snap-player"
              class:snap-player-on={room.phase === 'armed' && snapped.has(p.id)}
              animate:flip={{ duration: 600, easing: cubicOut }}
              in:fly={{ x: 30, duration: 360 }}
            >
              <span class="snap-pname">{p.name}</span>
              <span class="snap-pgain" class:snap-pgain-bad={g !== undefined && g < 0}>
                {#if room.phase === 'armed'}{snapped.has(p.id) ? 'Snap' : ''}{:else if g !== undefined && g !== 0}{signed(g)}{/if}
              </span>
              <span class="snap-pscore">{p.score}</span>
            </div>
          {/each}
        {/if}
      </div>
    </aside>
  </div>

  <footer class="snap-foot"><span class="snap-mark">sr.</span> {STING}</footer>
</div>

<style>
  .snap-root {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    padding: 1.6cqw 2cqw 1.2cqw;
    gap: 1.2cqw;
    font-family: var(--font-body);
    color: var(--chrome-ink);
  }
  .snap-top {
    display: flex;
    align-items: baseline;
    gap: 1.6cqw;
    border-bottom: 1px solid var(--on-ink-14);
    padding-bottom: 0.9cqw;
    min-width: 0;
  }
  .snap-brand,
  .snap-meta,
  .snap-kicker {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
    white-space: nowrap;
  }
  .snap-kicker {
    margin: 0;
  }
  .snap-kicker-accent {
    color: var(--accent-on-dark);
  }
  .snap-meta {
    display: flex;
    gap: 1.2cqw;
    letter-spacing: 0.08em;
  }
  .snap-mark {
    font-family: var(--font-brand);
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent-on-dark);
  }
  .snap-headline {
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
  .snap-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 24cqw;
    gap: 2.6cqw;
    min-height: 0;
  }
  .snap-main {
    position: relative;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
  }
  .snap-note {
    margin: 0;
    font-size: 1.6cqw;
    color: var(--on-ink-80);
    text-align: center;
  }

  /* The intro: the target alone. */
  .snap-intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8cqw;
    height: 100%;
    min-height: 0;
  }
  .snap-target-name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 4.6cqw;
    line-height: 1;
    letter-spacing: -0.02em;
    text-align: center;
  }
  .snap-intro-pic {
    flex: 1;
    min-height: 0;
    aspect-ratio: 1;
    max-width: 100%;
    display: grid;
    border: 0.4cqw solid var(--accent-on-dark);
    border-radius: 2px;
  }

  /* The run: one huge picture, the target in the corner. */
  .snap-stage {
    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
  }
  .snap-flip {
    height: 100%;
    aspect-ratio: 1;
    max-width: 100%;
    display: grid;
  }
  .snap-remind {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 9cqw;
    display: flex;
    flex-direction: column;
    gap: 0.4cqw;
    padding: 0.4cqw;
    border: 1px solid var(--on-ink-30);
    border-radius: 2px;
    background: var(--on-ink-05);
  }
  .snap-remind span {
    font-family: var(--font-mono);
    font-size: 0.9cqw;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-ink-55);
    text-align: center;
  }

  /* The result. */
  .snap-result {
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 2.6cqw;
    min-height: 0;
  }
  .snap-result-pic {
    height: 26cqw;
    aspect-ratio: 1;
    display: grid;
    border: 0.4cqw solid var(--accent-on-dark);
    border-radius: 2px;
  }
  .snap-ranked {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6cqw;
    min-height: 0;
    overflow: hidden;
  }
  .snap-rank {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 5cqw;
    align-items: center;
    gap: 1.4cqw;
    padding: 0.8cqw 1.2cqw;
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
  }
  .snap-rank-win {
    border-color: var(--accent-on-dark);
    background: var(--on-ink-05);
  }
  .snap-rname {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.1cqw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .snap-rtime {
    font-family: var(--font-mono);
    font-size: 1.5cqw;
    color: var(--on-ink-80);
    font-variant-numeric: tabular-nums;
  }
  .snap-rank-bad .snap-rtime,
  .snap-rank-bad .snap-rpts {
    color: var(--on-ink-45);
  }
  .snap-rpts {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.3cqw;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .snap-rank-win .snap-rpts {
    color: var(--accent-on-dark);
  }

  /* Countdown, lobby, ended. */
  .snap-ready {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.2cqw;
    text-align: center;
  }
  .snap-ready-label {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 4.4cqw;
    letter-spacing: -0.02em;
  }
  .snap-ready-num {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 16cqw;
    line-height: 1;
    color: var(--accent-on-dark);
  }
  .snap-lobby-pics {
    display: grid;
    grid-template-columns: repeat(4, 11cqw);
    gap: 1.2cqw;
  }

  /* The finish. */
  .snap-finish {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 1.6cqw;
  }
  .snap-finish-line {
    margin: 0 0 auto;
    padding-top: 1cqw;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3.4cqw;
    letter-spacing: -0.02em;
    text-align: center;
  }
  .snap-podium {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    align-items: end;
    gap: 1.4cqw;
  }
  .snap-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4cqw;
    min-width: 0;
  }
  .snap-step-1 {
    order: 2;
  }
  .snap-step-2 {
    order: 1;
  }
  .snap-step-3 {
    order: 3;
  }
  .snap-step-name {
    max-width: 100%;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.4cqw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .snap-step-score {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3.6cqw;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .snap-step-win .snap-step-name,
  .snap-step-win .snap-step-score {
    color: var(--accent-on-dark);
  }
  .snap-step-block {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 0.4cqw;
    padding-top: 1cqw;
    border: 1px solid var(--on-ink-14);
    border-bottom: 0;
    border-radius: 2px 2px 0 0;
    background: var(--on-ink-05);
  }
  .snap-step-1 .snap-step-block {
    height: 14cqw;
    background: var(--on-ink-12);
  }
  .snap-step-win .snap-step-block {
    border-color: var(--accent-on-dark);
  }
  .snap-step-2 .snap-step-block {
    height: 10cqw;
  }
  .snap-step-3 .snap-step-block {
    height: 7cqw;
  }
  .snap-step-place {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 4cqw;
    line-height: 1;
    color: var(--on-ink-55);
  }
  .snap-step-best {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    color: var(--on-ink-55);
  }

  /* The side column. */
  .snap-side {
    display: flex;
    flex-direction: column;
    gap: 1cqw;
    min-height: 0;
    min-width: 0;
  }
  .snap-players {
    display: grid;
    gap: 0.6cqw;
    min-height: 0;
    overflow: hidden;
  }
  .snap-player {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 3.6cqw;
    align-items: center;
    gap: 0.9cqw;
    padding: 0.7cqw 1.1cqw;
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
    background: var(--on-ink-05);
    transition:
      border-color 200ms ease,
      background-color 200ms ease;
  }
  .snap-player-on {
    border-color: var(--accent);
    background: var(--accent);
  }
  .snap-player-lead {
    border-color: var(--accent-on-dark);
  }
  .snap-pname {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.8cqw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .snap-pgain {
    font-family: var(--font-mono);
    font-size: 1.2cqw;
    color: var(--accent-on-dark);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .snap-player-on .snap-pgain {
    color: var(--chrome-ink);
  }
  .snap-pgain-bad {
    color: var(--on-ink-45);
  }
  .snap-pscore {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2cqw;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .snap-foot {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.08em;
    color: var(--on-ink-45);
  }
  @media (prefers-reduced-motion: reduce) {
    .snap-player {
      transition: none;
    }
  }
</style>
