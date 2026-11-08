<script lang="ts">
  // StackBar — one bar, showing composition. Preferred over a pie everywhere in this study:
  // the recurring question is "what share of this total is that part", and a bar answers it
  // without asking anyone to compare angles.
  interface Seg { label: string; value: number; tone?: string; note?: string }
  interface Props {
    segments: Seg[];
    unit?: string;
    height?: number;
    /** Hide segments narrower than this share (%) from inline labelling. */
    labelFloor?: number;
    selected?: string | null;
    onselect?: (label: string) => void;
  }
  let { segments, unit = '', height = 44, labelFloor = 9, selected = null, onselect }: Props = $props();

  const PALETTE = ['var(--er-orange)', 'var(--er-amber)', 'var(--er-bronze)', 'var(--er-petrol)', 'var(--er-brown)', 'var(--fg-3)'];
  const total = $derived(segments.reduce((a, s) => a + s.value, 0));
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const fmt = (v: number) => v.toLocaleString('en-GB');
</script>

<div class="sb">
  <div class="track" style="height:{height}px"
       role="img" aria-label={segments.map((s) => `${s.label} ${fmt(s.value)}${unit}, ${pct(s.value).toFixed(1)} percent`).join('; ')}>
    {#each segments as s, i (s.label)}
      <button class="seg" class:on={selected === s.label} disabled={!onselect}
              style="width:{pct(s.value)}%; --c:{s.tone ?? PALETTE[i % PALETTE.length]}"
              onclick={() => onselect?.(s.label)}
              title="{s.label} — {fmt(s.value)}{unit} ({pct(s.value).toFixed(1)}%){s.note ? '. ' + s.note : ''}">
        {#if pct(s.value) >= labelFloor}
          <span class="s-in">{pct(s.value).toFixed(0)}%</span>
        {/if}
      </button>
    {/each}
  </div>

  <ul class="key">
    {#each segments as s, i (s.label)}
      <li class:on={selected === s.label}>
        <span class="k-sw" style="background:{s.tone ?? PALETTE[i % PALETTE.length]}"></span>
        <span class="k-lab">{s.label}</span>
        <span class="k-val">{fmt(s.value)}{unit}</span>
        {#if s.note}<span class="k-note">{s.note}</span>{/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .sb { display: flex; flex-direction: column; gap: 9px; }
  .track { display: flex; width: 100%; border-radius: var(--radius-sharp); overflow: hidden;
    border: 1px solid var(--rule); }
  .seg { border: none; border-right: 1px solid var(--ground); background: color-mix(in srgb, var(--c) 80%, transparent);
    display: grid; place-items: center; cursor: pointer; min-width: 0; padding: 0;
    transition: background 0.14s, width 0.4s cubic-bezier(0.3,0,0.2,1); }
  .seg:last-child { border-right: none; }
  .seg:disabled { cursor: default; }
  .seg:not(:disabled):hover { background: var(--c); }
  .seg.on { background: var(--c); }
  .s-in { font-family: var(--er-mono); font-size: var(--fs-label-xs); font-weight: 600; color: #fff;
     }

  .key { list-style: none; margin: 0; padding: 0; display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 3px 14px; }
  .key li { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; font-size: var(--fs-label-xs);
    line-height: 1.45; color: var(--fg-2); padding: 2px 0; }
  .key li.on { color: var(--fg); font-weight: 500; }
  .k-sw { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; align-self: center; }
  .k-lab { min-width: 0; }
  .k-val { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); margin-left: auto; }
  .k-note { flex-basis: 100%; padding-left: 15px; font-size: var(--fs-label-xs); color: var(--fg-3); }
</style>
