<script lang="ts">
  // One player's board on the TV: name and score, the five pattern lines
  // filling towards the wall, the wall itself, and the floor. Every tile is
  // keyed by its id and moves through the shared crossfade (`motion.ts`), so
  // a turn shows its tiles flying in and a round's end shows each full line
  // sliding one tile onto the wall, with what it scored.
  import { untrack } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import AzulTile from './AzulTile.svelte';
  import { FLOOR_PENALTIES, receive, send, wallColour, type AzulPlayer, type AzulRoom } from './motion';

  let {
    player,
    active = false,
    fresh,
    scored = null,
    standing = null,
    remaining = null,
  }: {
    player: AzulPlayer;
    active?: boolean;
    /** Tile ids the last turn moved, to glow. */
    fresh: Set<number>;
    /** This round's scoring for this player, while the table watches it. */
    scored?: NonNullable<AzulRoom['roundScores']>[number] | null;
    standing?: NonNullable<AzulRoom['standings']>[number] | null;
    /** The turn clock left, 0–1, when it is this player's turn. */
    remaining?: number | null;
  } = $props();

  const shown = new Tween(untrack(() => player.score), { duration: 1400, easing: cubicOut });
  $effect(() => {
    const target = player.score;
    // Count up after the tiles have landed.
    const wait = untrack(() => (scored ? 300 + scored.placements.length * 320 : 0));
    const t = setTimeout(() => void shown.set(target), wait);
    return () => clearTimeout(t);
  });

  const placementAt = $derived.by(() => {
    const m = new Map<string, { points: number; order: number }>();
    scored?.placements.forEach((p, i) => m.set(`${p.line}:${p.col}`, { points: p.points, order: i }));
    return m;
  });

  const left = $derived(player.status !== 'joined');
  const rows = [0, 1, 2, 3, 4];
</script>

<article class="board" class:active class:left class:won={standing?.result === 'won' || standing?.result === 'drew'}>
  <header>
    <span class="name">{player.name}</span>
    <span class="chips">
      {#if left}<span class="chip">left</span>{/if}
      {#if player.away && !left}<span class="chip">away</span>{/if}
      {#if active}<span class="chip on">to play</span>{/if}
    </span>
    <span class="score" aria-label="{player.score} points">{Math.round(shown.current)}</span>
  </header>
  {#if active && remaining !== null}
    <div class="clock" aria-hidden="true"><span style:transform="scaleX({remaining})" class:low={remaining < 0.2}></span></div>
  {/if}

  <div class="mid">
    <div class="lines">
      {#each rows as r (r)}
        <div class="line">
          {#each Array.from({ length: r + 1 }, (_, k) => k) as k (k)}
            <span class="slot">
              {#each player.lines[r].slice(k, k + 1) as t (t.id)}
                <span class="place" in:receive={{ key: t.id }} out:send={{ key: t.id }}>
                  <AzulTile c={t.c} fresh={fresh.has(t.id)} />
                </span>
              {/each}
            </span>
          {/each}
        </div>
      {/each}
    </div>

    <div class="wall">
      {#each rows as r (r)}
        {#each rows as col (col)}
          {@const id = player.wall[r][col]}
          {@const placed = placementAt.get(`${r}:${col}`)}
          <span class="cell">
            <AzulTile c={wallColour(r, col)} ghost />
            {#each id === null ? [] : [id] as tid (tid)}
              <span class="place" in:receive={{ key: tid, delay: placed ? placed.order * 320 : 0 }} out:send={{ key: tid }}>
                <AzulTile c={wallColour(r, col)} />
              </span>
            {/each}
            {#if placed}
              <span class="pop" style:animation-delay="{placed.order * 320 + 380}ms">+{placed.points}</span>
            {/if}
          </span>
        {/each}
      {/each}
    </div>
  </div>

  <div class="floor">
    {#each FLOOR_PENALTIES as pen, k (k)}
      <span class="fslot">
        <span class="slot">
          {#each player.floor.slice(k, k + 1) as f (f.id)}
            <span class="place" in:receive={{ key: f.id }} out:send={{ key: f.id }}>
              <AzulTile c={f.c} fresh={fresh.has(f.id)} />
            </span>
          {/each}
        </span>
        <span class="pen">−{pen}</span>
      </span>
    {/each}
    {#if scored && scored.floor > 0}
      <span class="pop floorpop" style:animation-delay="{scored.placements.length * 320 + 380}ms">−{scored.floor}</span>
    {/if}
  </div>

  {#if standing?.bonus}
    <footer class="bonus">
      <span>rows {standing.bonus.rows} ×2</span>
      <span>columns {standing.bonus.columns} ×7</span>
      <span>colours {standing.bonus.colours} ×10</span>
      <strong>+{standing.bonus.points}</strong>
    </footer>
  {/if}
</article>

<style>
  .board {
    --t: 2cqw;
    --g: 0.22cqw;
    display: flex;
    flex-direction: column;
    gap: 0.55cqw;
    padding: 0.8cqw 1cqw 0.9cqw;
    border: 1px solid var(--on-ink-14);
    border-radius: 4px;
    background: var(--on-ink-05);
    transition:
      border-color 300ms ease,
      background-color 300ms ease,
      opacity 300ms ease;
  }
  .board.active {
    border-color: var(--accent-on-dark);
    background: var(--accent-on-dark-09);
  }
  .board.left {
    opacity: 0.45;
  }
  .board.won {
    border-color: var(--good-on-dark);
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 0.8cqw;
  }
  .name {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.5cqw;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chips {
    display: flex;
    gap: 0.4cqw;
    flex: 1;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: 0.85cqw;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.15cqw 0.5cqw;
    border: 1px solid var(--on-ink-30);
    border-radius: 100px;
    color: var(--on-ink-70);
  }
  .chip.on {
    border-color: var(--accent-on-dark);
    color: var(--accent-on-dark);
  }
  .score {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.1cqw;
    font-variant-numeric: tabular-nums;
    color: var(--chrome-ink);
  }
  .clock {
    height: 0.25cqw;
    background: var(--on-ink-12);
    border-radius: 100px;
    overflow: hidden;
    margin-top: -0.3cqw;
  }
  .clock span {
    display: block;
    height: 100%;
    background: var(--accent-on-dark);
    transform-origin: left;
    transition: transform 500ms linear;
  }
  .clock span.low {
    background: #cc4444;
  }
  .mid {
    display: flex;
    justify-content: center;
    gap: 0.8cqw;
    align-items: flex-start;
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--g);
  }
  .line {
    display: flex;
    flex-direction: row-reverse;
    gap: var(--g);
    /* Right-aligned: line 1 sits beside the wall, line 5 reaches furthest out. */
    width: calc(5 * var(--t) + 4 * var(--g));
  }
  .slot {
    position: relative;
    display: block;
    width: var(--t);
    height: var(--t);
    border-radius: 2px;
    box-sizing: border-box;
    border: 1px dashed var(--on-ink-16);
  }
  .place {
    position: absolute;
    inset: -1px;
    display: block;
  }
  .wall {
    display: grid;
    grid-template-columns: repeat(5, var(--t));
    gap: var(--g);
    padding-left: 0.8cqw;
    border-left: 1px solid var(--on-ink-14);
  }
  .cell {
    position: relative;
    width: var(--t);
    height: var(--t);
  }
  .cell .place {
    inset: 0;
  }
  .floor {
    position: relative;
    display: flex;
    gap: var(--g);
    align-items: flex-start;
  }
  .fslot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15cqw;
  }
  .pen {
    font-family: var(--font-mono);
    font-size: 0.8cqw;
    color: var(--on-ink-45);
  }
  .pop {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 2;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.5cqw;
    color: var(--accent-on-dark);
    pointer-events: none;
    opacity: 0;
    animation: pop 1.9s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .floorpop {
    left: calc(7 * (var(--t) + var(--g)) + 1.4cqw);
    top: 0.4cqw;
    color: #e07a6a;
  }
  .bonus {
    display: flex;
    gap: 0.9cqw;
    align-items: baseline;
    font-family: var(--font-mono);
    font-size: 0.95cqw;
    color: var(--on-ink-70);
  }
  .bonus strong {
    margin-left: auto;
    font-family: var(--font-display);
    font-size: 1.4cqw;
    color: var(--good-on-dark);
  }
  @keyframes pop {
    0% {
      opacity: 0;
      transform: translate(-50%, -20%) scale(0.6);
    }
    18% {
      opacity: 1;
      transform: translate(-50%, -90%) scale(1.15);
    }
    70% {
      opacity: 1;
      transform: translate(-50%, -120%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -160%) scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pop {
      animation-duration: 0.01ms;
      animation-iteration-count: 1;
    }
  }
</style>
