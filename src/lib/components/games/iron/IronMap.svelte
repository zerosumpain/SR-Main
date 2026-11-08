<script lang="ts">
  // The Iron Roads map: every route as a row of track pieces in its colour,
  // claimed routes as a solid line of the owner's carriages, the towns on top.
  // Pure SVG over the map module, so the TV board and a phone can both draw it.
  import { MAP_H, MAP_W, ROUTES, TOWNS, HEART, town } from '$lib/games/iron-roads-map';
  import { playerPaint, routePaint } from './colours';

  let {
    owners,
    seats,
    lastRoute = null,
    highlight = null,
    compact = false,
  }: {
    owners: (string | null)[];
    /** Seat by player id, for the owner's colour. */
    seats: Record<string, number | null>;
    lastRoute?: string | null;
    /** A route to pick out (the phone's chosen claim). */
    highlight?: string | null;
    /** A phone thumbnail: no names but Darlington's, thicker pieces. */
    compact?: boolean;
  } = $props();

  const TOWN_R = 9;
  const GAP = 5;

  const tracks = $derived(
    ROUTES.map((r, i) => {
      const A = town(r.a)!;
      const B = town(r.b)!;
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const d = Math.hypot(dx, dy);
      const ux = dx / d;
      const uy = dy / d;
      const inset = TOWN_R + 7;
      const span = d - inset * 2;
      const car = (span - GAP * (r.length - 1)) / r.length;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const cars = Array.from({ length: r.length }, (_, k) => {
        const along = inset + k * (car + GAP) + car / 2;
        return { x: A.x + ux * along, y: A.y + uy * along };
      });
      const owner = owners[i] ?? null;
      return {
        id: r.id,
        colour: r.colour,
        owner,
        paint: owner ? playerPaint(seats[owner]) : routePaint(r.colour),
        car,
        angle,
        cars,
        a: { x: A.x + ux * inset, y: A.y + uy * inset },
        b: { x: B.x - ux * inset, y: B.y - uy * inset },
        fresh: r.id === lastRoute,
        picked: r.id === highlight,
      };
    }),
  );

  /** The Stockton & Darlington, 1825: Shildon – Darlington – Stockton. */
  const LINE_1825 = ['shildon', 'darlington', 'stockton'].map((id) => town(id)!);

  const LABEL: Record<string, { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
    n: { dx: 0, dy: -17, anchor: 'middle' },
    s: { dx: 0, dy: 30, anchor: 'middle' },
    e: { dx: 16, dy: 6, anchor: 'start' },
    w: { dx: -16, dy: 6, anchor: 'end' },
    ne: { dx: 12, dy: -12, anchor: 'start' },
    nw: { dx: -12, dy: -12, anchor: 'end' },
    se: { dx: 12, dy: 26, anchor: 'start' },
    sw: { dx: -14, dy: 30, anchor: 'end' },
  };
  /** Darlington's name sits up and to the left, between the Barnard Castle line and the 1825 line. */
  const HEART_LABEL = { dx: -22, dy: -24, anchor: 'end' as const };
  const pieceH = $derived(compact ? 15 : 12);
</script>

<svg class="iron-map" class:iron-compact={compact} viewBox="-30 -20 {MAP_W + 60} {MAP_H + 50}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="The Iron Roads map">
  <polyline class="iron-1825" points={LINE_1825.map((t) => `${t.x},${t.y}`).join(' ')} />
  {#if !compact}
    <text class="iron-1825-label" x={(LINE_1825[1].x + LINE_1825[2].x) / 2 + 6} y={(LINE_1825[1].y + LINE_1825[2].y) / 2 + 34}>1825</text>
  {/if}

  {#each tracks as t (t.id)}
    <g class="iron-route" class:iron-owned={t.owner} class:iron-fresh={t.fresh} class:iron-picked={t.picked} class:iron-black={!t.owner && t.colour === 'black'}>
      {#if t.owner}
        <line class="iron-rail" x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} stroke={t.paint} />
      {/if}
      {#if t.fresh || t.picked}
        <line class="iron-halo" x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} />
      {/if}
      {#each t.cars as c, k (k)}
        <rect
          class="iron-piece"
          x={-t.car / 2}
          y={-(t.owner ? pieceH + 3 : pieceH) / 2}
          width={t.car}
          height={t.owner ? pieceH + 3 : pieceH}
          rx="2"
          fill={t.paint}
          transform="translate({c.x} {c.y}) rotate({t.angle})"
        />
      {/each}
    </g>
  {/each}

  {#each TOWNS as tw (tw.id)}
    {@const heart = tw.id === HEART}
    {@const l = LABEL[tw.label]}
    <g class="iron-town" class:iron-heart={heart}>
      <circle cx={tw.x} cy={tw.y} r={heart ? 15 : TOWN_R} />
      {#if heart}<circle class="iron-heart-core" cx={tw.x} cy={tw.y} r="6" />{/if}
      {#if !compact || heart}
        {@const size = heart ? (compact ? 34 : 27) : 19}
        {@const tx = tw.x + (heart ? HEART_LABEL.dx : l.dx)}
        {@const ty = tw.y + (heart ? HEART_LABEL.dy : l.dy)}
        {@const w = tw.name.length * size * (heart ? 0.6 : 0.54) + 10}
        <rect
          class="iron-plate"
          x={(heart ? HEART_LABEL.anchor : l.anchor) === 'start' ? tx - 5 : (heart ? HEART_LABEL.anchor : l.anchor) === 'end' ? tx - w + 5 : tx - w / 2}
          y={ty - size * 0.82}
          width={w}
          height={size * 1.08}
          rx="2"
        />
        <text x={tx} y={ty} text-anchor={heart ? HEART_LABEL.anchor : l.anchor}>{tw.name}</text>
      {/if}
    </g>
  {/each}
</svg>

<style>
  .iron-map {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .iron-1825 {
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 30;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.13;
  }
  .iron-plate {
    fill: var(--chrome-bg);
    opacity: 0.72;
  }
  .iron-1825-label {
    font-family: var(--font-mono);
    font-size: 15px;
    letter-spacing: 0.14em;
    fill: var(--accent-on-dark);
  }
  .iron-piece {
    stroke: var(--chrome-bg);
    stroke-width: 1.5;
  }
  .iron-black .iron-piece {
    stroke: var(--on-ink-55);
  }
  .iron-owned .iron-piece {
    stroke: var(--chrome-bg);
    stroke-width: 2.5;
  }
  .iron-rail {
    stroke-width: 6;
    stroke-linecap: round;
  }
  .iron-halo {
    stroke: var(--chrome-ink);
    stroke-width: 30;
    stroke-linecap: round;
    opacity: 0.22;
  }
  .iron-fresh .iron-halo {
    animation: iron-pulse 1.6s ease-in-out infinite;
  }
  .iron-picked .iron-halo {
    stroke: var(--accent-on-dark);
    opacity: 0.55;
  }
  @keyframes iron-pulse {
    0%,
    100% {
      opacity: 0.12;
    }
    50% {
      opacity: 0.4;
    }
  }
  .iron-town circle {
    fill: var(--chrome-ink);
    stroke: var(--chrome-bg);
    stroke-width: 3.5;
  }
  .iron-heart circle {
    fill: var(--accent-on-dark);
    stroke: var(--chrome-ink);
    stroke-width: 3;
  }
  .iron-heart .iron-heart-core {
    fill: var(--chrome-bg);
    stroke: none;
  }
  .iron-town text {
    font-family: var(--font-body);
    font-weight: 600;
    font-size: 19px;
    fill: var(--chrome-ink);
  }
  .iron-heart text {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 27px;
    fill: var(--accent-on-dark);
    letter-spacing: -0.01em;
  }
  .iron-compact .iron-heart text {
    font-size: 34px;
  }
  .iron-compact .iron-town circle {
    stroke-width: 4;
  }
</style>
