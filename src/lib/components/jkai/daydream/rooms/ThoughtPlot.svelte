<script lang="ts">
  // The bar, made spatial.
  //
  // The rows say what a musing scored; they cannot say what that score MEANT,
  // because the number it had to beat is a moving target — the threshold falls
  // as answers come in. Here height is the whole point: distance above or below
  // the line the musing had to clear. Four over it reached him; the ones under
  // it are still sitting there, waiting for one more card.
  //
  // Picking a mark opens the SAME drill the rows open. A second thread panel
  // beside the field would be a second place for the evidence chain to drift.
  export interface PlotPoint {
    id: string;
    /** The family mark — `MUSE`, `PLACE`. */
    mark: string;
    score: number;
    at: string;
    title: string;
  }

  interface Props {
    points: PlotPoint[];
    /** The bar itself. Falls as answers come in, so it is read, never assumed. */
    threshold: number;
    openId?: string | null;
    onpick: (id: string) => void;
  }

  let { points, threshold, openId = null, onpick }: Props = $props();

  /** Where the bar sits in the field. Fixed rather than derived from the data
   *  so the line does not jump between loads: it is the reader's constant. */
  const BAR = 0.38;

  const sorted = $derived([...points].sort((a, b) => a.at.localeCompare(b.at)));

  /** The score range, padded, so a cluster near the bar still spreads out. */
  const span = $derived.by(() => {
    const scores = sorted.map((p) => p.score);
    const hi = Math.max(threshold + 0.08, ...scores);
    const lo = Math.min(threshold - 0.08, ...scores);
    return { hi, lo };
  });

  /** Score → percentage from the top. Above the bar and below it are scaled
   *  separately, so the line stays at BAR whatever the spread either side.
   *
   *  Clamped inside the field rather than allowed to reach 0 or 100: a mark is
   *  centred on its position, so an extreme value would hang half outside the
   *  box and its label would land on the axis. */
  function y(score: number): number {
    const { hi, lo } = span;
    const raw =
      score >= threshold
        ? BAR - (BAR * (score - threshold)) / (hi - threshold || 1)
        : BAR + (1 - BAR) * ((threshold - score) / (threshold - lo || 1));
    return Math.min(0.94, Math.max(0.09, raw)) * 100;
  }

  function x(i: number): number {
    if (sorted.length <= 1) return 50;
    const first = new Date(sorted[0].at).getTime();
    const last = new Date(sorted[sorted.length - 1].at).getTime();
    const t = new Date(sorted[i].at).getTime();
    // Inset on both sides: the left gutter belongs to the CLEAR/HELD edge
    // labels, and a mark centred on 0% would sit half outside the border.
    return last === first ? 50 : ((t - first) / (last - first)) * 84 + 11;
  }

  /** A mark is sized by how far clear of the bar it got: a musing that only
   *  just cleared reads as only just clearing. */
  function size(score: number): number {
    const { hi, lo } = span;
    const room = score >= threshold ? hi - threshold || 1 : threshold - lo || 1;
    const margin = Math.abs(score - threshold) / room;
    return Math.round(10 + margin * 10);
  }

  const DATE = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
  });

  /** Four labels across the axis, from the real range — never four fixed days. */
  const axis = $derived.by(() => {
    if (!sorted.length) return [];
    const first = new Date(sorted[0].at).getTime();
    const last = new Date(sorted[sorted.length - 1].at).getTime();
    if (last === first) return [DATE.format(new Date(first))];
    return [0, 1, 2, 3].map((i) => DATE.format(new Date(first + ((last - first) * i) / 3)));
  });
</script>

<div class="tp">
  <div class="tp-field">
    <div class="tp-bar" style="top: {BAR * 100}%">
      <span class="tp-bar-label">The bar · {threshold.toFixed(2)}</span>
    </div>
    {#each sorted as p, i (p.id)}
      {@const over = p.score >= threshold}
      {@const s = size(p.score)}
      <button
        type="button"
        class="tp-mark"
        class:over
        class:on={openId === p.id}
        style="left: {x(i)}%; top: {y(p.score)}%; --s: {s}px"
        title="{p.title} — {p.score.toFixed(2)}, {over ? 'clear of the bar' : 'still under it'}"
        onclick={() => onpick(p.id)}
      >
        <span class="tp-mark-label">{p.mark} {p.score.toFixed(2)}</span>
        <span class="tp-square"></span>
      </button>
    {/each}
    <span class="tp-edge tp-edge-top">Clear</span>
    <span class="tp-edge tp-edge-bottom">Held</span>
  </div>

  <div class="tp-axis">
    {#each axis as d (d)}<span>{d}</span>{/each}
  </div>
</div>

<style>
  .tp-field {
    position: relative;
    height: 300px;
    margin-top: 14px;
    border-left: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  /* Dashed, because it is a threshold rather than an axis — and it moves. */
  .tp-bar {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 2px dashed rgba(26, 16, 8, 0.35);
  }
  .tp-bar-label {
    position: absolute;
    right: 0;
    top: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    background: var(--bg);
    padding-left: 6px;
  }

  .tp-mark {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    /* Colour is the hover language here as everywhere else: no scale, no
       shadow, and nothing that moves the mark away from its own value. */
    transition: opacity var(--t-fast) var(--ease-out);
  }
  .tp-mark:hover {
    opacity: 0.75;
  }
  .tp-mark:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .tp-square {
    width: var(--s);
    height: var(--s);
    /* Under the bar is an OUTLINE: the musing exists and is not filled in yet. */
    border: 2px solid var(--warn);
  }
  .tp-mark.over .tp-square {
    border-color: var(--accent);
    background: var(--accent);
  }
  .tp-mark.on .tp-square {
    outline: 2px solid var(--text-primary);
    outline-offset: 2px;
  }

  .tp-mark-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1;
    white-space: nowrap;
    color: var(--text-muted);
  }
  .tp-mark.over .tp-mark-label {
    color: var(--accent);
  }

  .tp-edge {
    position: absolute;
    left: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .tp-edge-top {
    top: 4px;
  }
  .tp-edge-bottom {
    bottom: 4px;
  }

  .tp-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
</style>
