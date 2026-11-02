<script lang="ts">
  // Biscuit Tower on the TV: the crane swinging the next item, the tower on
  // its plinth, the physics run here (`physics.ts`). When this board is a
  // party's TV it says how each drop landed (`report`); a board paired from a
  // phone only watches, and the room counts a drop it never hears about as
  // settled.
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { craneX, type ScreenRoom } from '$lib/games/biscuit-tower';
  import { STING, hostLine } from '$lib/games/kelly';
  import { LiveDrop, PLINTH_HALF, SHAPES, SWING, Tower, UNIT, type Outcome } from './physics';

  let {
    room,
    skewMs = 0,
    report,
  }: {
    room: ScreenRoom;
    skewMs?: number;
    report?: (body: { turn: number; outcome: 'settled' | 'toppled'; height: number }) => void;
  } = $props();

  let now = $state(Date.now());
  let canvas: HTMLCanvasElement | undefined = $state();

  // Plain handles and simulation state (svelte5-pitfalls §1): the frame loop reads `latest`.
  let latest: ScreenRoom = room;
  let tower: Tower | null = null;
  let towerRound = -1;
  let building = false;
  let simulated = 0;
  let live: LiveDrop | null = null;
  let liveTurn = -1;
  const reported = new Set<number>();
  let frame = 0;

  $effect(() => {
    latest = room;
  });

  const serverNow = $derived(now + skewMs);
  const nameOf = (id: string | null | undefined) => room.players.find((p) => p.id === id)?.name ?? '';
  const turnLeft = $derived(room.phase === 'aiming' && room.phaseEndsAt ? Math.max(0, Math.ceil((room.phaseEndsAt - serverNow) / 1000)) : null);
  const board = $derived(
    [...room.players].filter((p) => p.status === 'joined' || p.score > 0).sort((a, b) => b.score - a.score || a.topples - b.topples || a.name.localeCompare(b.name)),
  );
  const lastDrop = $derived(room.drops.length ? room.drops[room.drops.length - 1] : null);
  const headline = $derived.by(() => {
    switch (room.phase) {
      case 'lobby':
        return 'Waiting for the host';
      case 'countdown':
        return 'Steady hands';
      case 'aiming':
        return `${nameOf(room.turn?.playerId)} — drop ${room.turn?.itemLabel ?? ''}`;
      case 'falling':
        return 'Will it hold?';
      case 'toppled':
        return `Down it goes — ${nameOf(lastDrop?.playerId)} knocked it over`;
      case 'finished': {
        const w = room.winnerIds.map(nameOf);
        const top = room.standings?.[0];
        return w.length > 1 ? `${w.join(' and ')} share it` : w.length ? hostLine('winner', room.round * 7 + (top?.score ?? 0), w[0]) : hostLine('nobody', room.round);
      }
      default:
        return 'That game has ended';
    }
  });

  async function rebuild(round: number) {
    building = true;
    tower?.free();
    tower = null;
    simulated = 0;
    live = null;
    liveTurn = -1;
    try {
      tower = await Tower.create();
      towerRound = round;
    } finally {
      building = false;
    }
  }

  function send(turn: number, out: Outcome) {
    if (!report || reported.has(turn)) return;
    reported.add(turn);
    report({ turn, ...out });
  }

  function simulate() {
    const r = latest;
    if (building) return;
    if (!tower || towerRound !== r.round) {
      void rebuild(r.round);
      return;
    }
    // Catch up on drops this board has not seen: all but a live one are run out unseen.
    while (simulated < r.drops.length) {
      const d = r.drops[simulated];
      const isLast = simulated === r.drops.length - 1;
      tower.drop(d.item, d.x);
      simulated++;
      if (isLast && d.outcome === null && r.phase === 'falling') {
        live = new LiveDrop(tower);
        liveTurn = d.turn;
      } else {
        tower.settleNow();
      }
    }
    if (live) {
      const out = live.tick();
      if (out) {
        live = null;
        send(liveTurn, out);
      }
    } else if (r.phase === 'toppled' || r.phase === 'falling') {
      // Let a collapse play out on screen.
      tower.step();
    }
  }

  function draw() {
    const c = canvas;
    if (!c || !tower) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const r = latest;
    const top = tower.top();
    // The camera keeps the plinth, the swing and the crane in view as the tower grows.
    const viewH = Math.max(7, top + 3.6);
    const scale = Math.min(w / ((SWING + 1.2) * 2), (h * 0.9) / viewH);
    const ox = w / 2;
    const oy = h * 0.93;
    const X = (x: number) => ox + x * scale;
    const Y = (y: number) => oy - y * scale;

    // Plinth.
    g.fillStyle = 'rgba(237, 228, 212, 0.16)';
    g.fillRect(X(-PLINTH_HALF), Y(0), PLINTH_HALF * 2 * scale, 0.4 * scale);
    g.fillStyle = 'rgba(237, 228, 212, 0.4)';
    g.fillRect(X(-PLINTH_HALF), Y(0), PLINTH_HALF * 2 * scale, 3);

    // Best height so far this game.
    if (r.best) {
      const by = Y(r.best.height * UNIT);
      g.strokeStyle = 'rgba(224, 123, 42, 0.5)';
      g.setLineDash([8, 8]);
      g.beginPath();
      g.moveTo(X(-SWING - 1), by);
      g.lineTo(X(SWING + 1), by);
      g.stroke();
      g.setLineDash([]);
    }

    for (const p of tower.pieces) {
      const t = p.body.translation();
      paint(g, p.item, X(t.x), Y(t.y), -p.body.rotation(), scale);
    }

    // The crane: a rail, a trolley swinging on the turn's clock, the item hanging.
    const railY = top + 2.2 + 0.9;
    g.strokeStyle = 'rgba(237, 228, 212, 0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(X(-SWING - 0.6), Y(railY));
    g.lineTo(X(SWING + 0.6), Y(railY));
    g.stroke();
    if (r.phase === 'aiming' && r.turn) {
      const x = craneX(Date.now() + skewMs, r.turn.startsAt, r.periodMs) * SWING;
      const hangY = top + 2.2;
      g.strokeStyle = 'rgba(237, 228, 212, 0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(X(x), Y(railY));
      g.lineTo(X(x), Y(hangY + SHAPES[r.turn.item].hh));
      g.stroke();
      g.fillStyle = '#e07b2a';
      g.fillRect(X(x) - 0.25 * scale, Y(railY) - 0.12 * scale, 0.5 * scale, 0.24 * scale);
      paint(g, r.turn.item, X(x), Y(hangY), 0, scale);
    }
  }

  /** One item, centred at (cx, cy) in screen pixels. */
  function paint(g: CanvasRenderingContext2D, item: keyof typeof SHAPES, cx: number, cy: number, angle: number, scale: number) {
    const s = SHAPES[item];
    const w = s.hw * 2 * scale;
    const h = s.hh * 2 * scale;
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    g.fillStyle = s.fill;
    g.strokeStyle = s.edge;
    g.lineWidth = Math.max(1.5, scale * 0.03);
    const rr = s.kind === 'round' ? Math.min(w, h) / 2.4 : s.kind === 'bar' ? Math.min(w, h) / 6 : Math.min(w, h) / 5;
    g.beginPath();
    g.roundRect(-w / 2, -h / 2, w, h, rr);
    g.fill();
    g.stroke();
    // A little character per item, so the kitchen reads from the sofa.
    g.fillStyle = s.edge;
    if (item === 'custard' || item === 'bourbon') {
      for (let i = -2; i <= 2; i++) g.fillRect(i * w * 0.16 - 1.5, -h * 0.18, 3, h * 0.36);
    } else if (item === 'digestive') {
      for (let i = -1; i <= 1; i++) g.fillRect(i * w * 0.22 - 1.5, -1.5, 3, 3);
    } else if (item === 'brick') {
      g.fillRect(-w / 2, -1, w, 2);
      g.fillRect(-1, -h / 2, 2, h / 2);
    } else if (item === 'mug') {
      g.beginPath();
      g.arc(w / 2 + w * 0.12, 0, h * 0.2, -Math.PI / 2, Math.PI / 2);
      g.lineWidth = Math.max(2, scale * 0.05);
      g.stroke();
      g.fillStyle = '#7a4a26';
      g.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, h * 0.16);
    } else if (item === 'teapot' || item === 'kettle') {
      g.lineWidth = Math.max(2, scale * 0.05);
      g.beginPath();
      g.moveTo(w / 2, h * 0.05);
      g.lineTo(w / 2 + w * 0.3, -h * 0.3);
      g.stroke();
      g.fillRect(-w * 0.12, -h / 2 - h * 0.12, w * 0.24, h * 0.12);
    } else if (item === 'scone') {
      g.fillRect(-w / 2 + 2, -2, w - 4, 4);
    }
    g.restore();
  }

  onMount(() => {
    let alive = true;
    let last = performance.now();
    const loop = (t: number) => {
      if (!alive) return;
      // A fixed 60 Hz step however fast the TV paints; at most four to catch up after a stall.
      const steps = Math.min(4, Math.max(1, Math.round((t - last) / (1000 / 60))));
      last = t;
      for (let i = 0; i < steps; i++) simulate();
      draw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const clock = setInterval(() => (now = Date.now()), 250);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      clearInterval(clock);
      tower?.free();
      tower = null;
    };
  });
</script>

<div class="bt">
  <header class="bt-top">
    <span class="bt-brand"><span class="bt-mark">sr.</span> biscuit tower</span>
    {#key headline}
      <h1 in:fly={{ y: -12, duration: 360 }}>{headline}</h1>
    {/key}
    <span class="bt-meta">
      {#if room.round}<span>Round {room.round} of {room.rounds}</span>{/if}
      {#if turnLeft !== null}<span class="bt-clock" class:bt-low={turnLeft <= 3}>{turnLeft}s</span>{/if}
    </span>
  </header>

  <div class="bt-body">
    <div class="bt-stage">
      <canvas bind:this={canvas} class="bt-canvas"></canvas>
      {#if room.phase === 'countdown' && room.phaseEndsAt}
        <div class="bt-count" in:fade>{Math.max(0, Math.ceil((room.phaseEndsAt - serverNow) / 1000))}</div>
      {/if}
      {#if room.phase === 'finished'}
        <div class="bt-final" in:fade>
          <p class="bt-kicker">Final scores</p>
          <ol>
            {#each room.standings ?? [] as s, i (s.id)}
              <li class:bt-win={room.winnerIds.includes(s.id)}>
                <span>{i + 1}. {s.name}</span>
                <span>{s.score} landed{s.topples ? ` · ${s.topples} topple${s.topples === 1 ? '' : 's'}` : ''}</span>
              </li>
            {/each}
          </ol>
          {#if room.best}<p class="bt-best">Tallest tower: {room.best.height} biscuits, topped by {nameOf(room.best.playerId)}</p>{/if}
        </div>
      {/if}
    </div>

    <aside class="bt-side">
      <p class="bt-label">Landed</p>
      <ul class="bt-scores">
        {#each board as p (p.id)}
          <li animate:flip={{ duration: 300 }} class:bt-turn={room.phase === 'aiming' && room.turn?.playerId === p.id}>
            <span class="bt-name">{p.name}</span>
            <span class="bt-score">{p.score}</span>
          </li>
        {/each}
      </ul>
      {#if lastDrop?.height != null}
        <p class="bt-label">Tower</p>
        <p class="bt-height">{lastDrop.height} <span>biscuits</span></p>
      {/if}
      {#if room.best}
        <p class="bt-note">Best: {room.best.height} by {nameOf(room.best.playerId)}</p>
      {/if}
    </aside>
  </div>

  <p class="bt-sting"><span class="bt-mark">sr.</span> {STING}</p>
</div>

<style>
  .bt {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 2.4cqw 2cqw 1.6cqw;
    color: var(--chrome-ink);
    font-family: var(--font-body);
  }
  .bt-top {
    display: flex;
    align-items: baseline;
    gap: 1.6cqw;
    border-bottom: 1px solid var(--on-ink-14);
    padding-bottom: 1.2cqw;
  }
  .bt-brand {
    font-family: var(--font-mono);
    font-size: 1.2cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
    white-space: nowrap;
  }
  .bt-mark {
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
    font-size: 2.6cqw;
    line-height: 1.1;
  }
  .bt-meta {
    display: flex;
    gap: 1.4cqw;
    font-family: var(--font-mono);
    font-size: 1.2cqw;
    color: var(--on-ink-70);
    letter-spacing: 0.08em;
  }
  .bt-clock {
    color: var(--chrome-ink);
  }
  .bt-low {
    color: var(--accent-on-dark);
  }
  .bt-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 22cqw;
    gap: 2cqw;
    margin-top: 1.4cqw;
  }
  .bt-stage {
    position: relative;
    min-height: 0;
  }
  .bt-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .bt-count {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 14cqw;
  }
  .bt-final {
    position: absolute;
    inset: 4cqw 8cqw;
    display: flex;
    flex-direction: column;
    gap: 1cqw;
    padding: 2cqw;
    background: var(--chrome-bg);
    border: 1px solid var(--on-ink-30);
    border-radius: 2px;
  }
  .bt-final ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6cqw;
  }
  .bt-final li {
    display: flex;
    justify-content: space-between;
    font-size: 2cqw;
    padding: 0.6cqw 1cqw;
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
  }
  .bt-final li.bt-win {
    border-color: var(--accent);
    color: var(--accent-on-dark);
  }
  .bt-kicker,
  .bt-label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .bt-best,
  .bt-note {
    margin: 0;
    font-size: 1.4cqw;
    color: var(--on-ink-70);
  }
  .bt-side {
    display: flex;
    flex-direction: column;
    gap: 0.8cqw;
  }
  .bt-scores {
    list-style: none;
    margin: 0 0 1cqw;
    padding: 0;
    display: grid;
    gap: 0.6cqw;
  }
  .bt-scores li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.8cqw 1.1cqw;
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
    background: var(--on-ink-05);
  }
  .bt-scores li.bt-turn {
    border-color: var(--accent);
  }
  .bt-name {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.8cqw;
  }
  .bt-score {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2cqw;
  }
  .bt-height {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 4cqw;
  }
  .bt-height span {
    font-family: var(--font-mono);
    font-weight: 400;
    font-size: 1.2cqw;
    color: var(--on-ink-55);
  }
  .bt-sting {
    margin: 0.6cqw 0 0;
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.1em;
    color: var(--on-ink-45);
  }
</style>
