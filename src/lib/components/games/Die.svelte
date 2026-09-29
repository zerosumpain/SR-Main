<script lang="ts">
  // One die, drawn as pips — an SVG, not a glyph: the Unicode dice faces
  // render at whatever weight the fallback font gives them and read as emoji
  // on a phone. Square corners at 2px, the system's only radius under a pill.
  //
  // `value` null is a die under the cup: the face is blank and hatched, which
  // is how everyone else's dice look until a call lifts them.
  interface Props {
    value: number | null;
    /** Rendered edge in px. */
    size?: number;
    /** Counts towards the called bid — accent fill at the reveal. */
    hit?: boolean;
    /** A one standing in for the called face (wild) — outlined, not filled. */
    wild?: boolean;
    /** Faded: counts for nothing at the reveal. */
    dim?: boolean;
    label?: string;
  }

  let { value, size = 40, hit = false, wild = false, dim = false, label }: Props = $props();

  // Pip centres on a 3×3 grid, per face.
  const PIPS: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
  };
  const pips = $derived(value ? (PIPS[value] ?? []) : []);
  const name = $derived(label ?? (value ? `a ${value}` : 'a hidden die'));
</script>

<svg
  class="die"
  class:hit
  class:wild
  class:dim
  class:hidden={value === null}
  viewBox="0 0 40 40"
  width={size}
  height={size}
  role="img"
  aria-label={name}
>
  <rect x="1" y="1" width="38" height="38" rx="2" class="face" />
  {#if value === null}
    <path d="M8 32 32 8M8 22 22 8M18 32 32 18" class="hatch" />
  {/if}
  {#each pips as [cx, cy], i (i)}
    <circle cx={10 + cx * 10} cy={10 + cy * 10} r="3.6" class="pip" />
  {/each}
</svg>

<style>
  .die {
    display: block;
    flex: none;
  }
  .face {
    fill: var(--surface-card);
    stroke: var(--text-primary);
    stroke-width: 1.5;
  }
  .pip {
    fill: var(--text-primary);
  }
  .hidden .face {
    fill: var(--card-bg);
    stroke: var(--line-strong);
  }
  .hatch {
    stroke: var(--line-strong);
    stroke-width: 1.2;
    fill: none;
  }
  .hit .face {
    fill: var(--accent);
    stroke: var(--accent);
  }
  .hit .pip {
    fill: var(--bg);
  }
  .wild .face {
    stroke: var(--accent);
    stroke-width: 3;
  }
  .dim {
    opacity: 0.35;
  }
</style>
