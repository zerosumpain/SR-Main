<script lang="ts">
  // Treemap — area proportional to value, laid out by slice-and-dice with alternating
  // direction so the cells stay roughly square. Deliberately dependency-free: this study
  // argues for reaching for the simple tool when the data is small, so it uses one.
  interface Cell { label: string; value: number; note?: string; tone?: string }
  interface Props {
    cells: Cell[];
    height?: number;
    unit?: string;
    tone?: string;
    selected?: string | null;
    onselect?: (label: string) => void;
  }
  let { cells, height = 220, unit = '', tone = 'var(--accent-ink)', selected = null, onselect }: Props = $props();

  interface Laid extends Cell { x: number; y: number; w: number; h: number }

  // Slice-and-dice: sort descending, then repeatedly split the remaining rectangle along its
  // longer axis in proportion to the next cell's share. Not optimal aspect ratio, but stable,
  // order-preserving and short enough to read.
  const laid = $derived.by((): Laid[] => {
    const sorted = [...cells].filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
    const total = sorted.reduce((a, c) => a + c.value, 0);
    if (!total) return [];
    const out: Laid[] = [];
    let x = 0, y = 0, w = 100, h = 100, left = total;
    sorted.forEach((c, i) => {
      const share = c.value / left;
      if (i === sorted.length - 1) { out.push({ ...c, x, y, w, h }); return; }
      if (w >= h) {
        const cw = w * share;
        out.push({ ...c, x, y, w: cw, h });
        x += cw; w -= cw;
      } else {
        const ch = h * share;
        out.push({ ...c, x, y, w, h: ch });
        y += ch; h -= ch;
      }
      left -= c.value;
    });
    return out;
  });

  const fmt = (v: number) => v.toLocaleString('en-GB');

  const summary = $derived(
    'Area proportional to value. ' + cells.map((c) => `${c.label}: ${fmt(c.value)}${unit}`).join('; ') + '.',
  );
</script>

<div class="tm" style="height:{height}px; --tone:{tone}" role="img" aria-label={summary}>
  {#each laid as c (c.label)}
    <button class="cell" class:on={selected === c.label} disabled={!onselect}
            style="left:{c.x}%; top:{c.y}%; width:{c.w}%; height:{c.h}%; {c.tone ? `--cell:${c.tone}` : ''}"
            onclick={() => onselect?.(c.label)}
            title="{c.label} — {fmt(c.value)}{unit}{c.note ? '. ' + c.note : ''}">
      <span class="c-lab">{c.label}</span>
      <span class="c-val">{fmt(c.value)}{unit}</span>
    </button>
  {/each}
</div>

<style>
  .tm { position: relative; width: 100%; border-radius: var(--radius-sharp); overflow: hidden;
    border: 1px solid rgba(28,22,17,0.16); background: rgba(28,22,17,0.04); }
  .cell { position: absolute; border: 1px solid rgba(255,255,255,0.7); background: color-mix(in srgb, var(--cell, var(--tone)) 22%, transparent);
    display: flex; flex-direction: column; justify-content: flex-start; gap: 1px; padding: 5px 7px;
    overflow: hidden; text-align: left; cursor: pointer; font-family: inherit; min-width: 0;
    transition: background 0.14s; }
  .cell:disabled { cursor: default; }
  .cell:not(:disabled):hover { background: color-mix(in srgb, var(--cell, var(--tone)) 40%, transparent); }
  .cell.on { background: color-mix(in srgb, var(--cell, var(--tone)) 52%, transparent);
    border-color: var(--cell, var(--tone)); }
  .c-lab { font-size: var(--fs-label-xs); font-weight: 600; line-height: 1.2; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .c-val { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.62);
    white-space: nowrap; }
</style>
