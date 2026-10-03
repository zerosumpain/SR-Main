<script lang="ts">
  // Bars — horizontal comparative bars. The workhorse: any "this vs that, to scale" claim
  // on this study should be one of these rather than a sentence containing two numbers.
  interface Item { label: string; value: number; note?: string; tone?: string; muted?: boolean }
  interface Props {
    items: Item[];
    /** Suffix on the value label. */
    unit?: string;
    /** Force the scale — otherwise the largest item is full width. */
    max?: number;
    /** Draw a dashed reference line at this value. */
    threshold?: number;
    thresholdLabel?: string;
    tone?: string;
    /** Thousands separators; off for small numbers. */
    grouped?: boolean;
    height?: number;
  }
  let { items, unit = '', max, threshold, thresholdLabel, tone, grouped = true, height = 26 }: Props = $props();

  const top = $derived(max ?? Math.max(...items.map((i) => i.value), threshold ?? 0));
  const pct = (v: number) => (top > 0 ? Math.max((v / top) * 100, v > 0 ? 0.6 : 0) : 0);
  const fmt = (v: number) => (grouped ? v.toLocaleString('en-GB') : String(v));

  // Announced as a chart, with the data in words. The bars render their labels and values as
  // real text too, so this is belt and braces rather than the only route in.
  const summary = $derived(
    items.map((i) => `${i.label}: ${fmt(i.value)}${unit}`).join('; ')
      + (threshold !== undefined ? `. Reference line at ${fmt(threshold)}${unit}${thresholdLabel ? ` — ${thresholdLabel}` : ''}` : ''),
  );
  import { shown } from '../../lib/motion';
</script>

<div class="bars" {@attach shown()} style={tone ? `--tone:${tone}` : ""} role="img" aria-label={summary}>
  {#each items as it}
    <div class="row">
      <span class="b-lab" title={it.label}>{it.label}</span>
      <div class="b-track" style="height:{height}px">
        <div class="b-fill" class:muted={it.muted}
             style="width:{pct(it.value)}%; {it.tone ? `background:${it.tone}` : ''}"></div>
        {#if threshold !== undefined}
          <div class="b-thresh" style="left:{pct(threshold)}%" title={thresholdLabel ?? `threshold ${fmt(threshold)}`}></div>
        {/if}
        <span class="b-val">{fmt(it.value)}{unit}</span>
      </div>
      {#if it.note}<span class="b-note">{it.note}</span>{/if}
    </div>
  {/each}
  {#if threshold !== undefined && thresholdLabel}
    <p class="th-key"><span class="th-dash" aria-hidden="true"></span>{thresholdLabel}</p>
  {/if}
</div>

<style>
  .bars { display: flex; flex-direction: column; gap: 7px; }
  .row { display: grid; grid-template-columns: minmax(90px, 21ch) 1fr; gap: 4px 11px; align-items: center; }
  .b-lab { font-size: var(--fs-label); line-height: 1.3; color: var(--fg-2); text-align: right;
    overflow: hidden; text-overflow: ellipsis; }
  .b-track { position: relative; background: var(--wash); border-radius: var(--radius-sharp);
    overflow: hidden; display: flex; align-items: center; }
  .b-fill { position: absolute; inset: 0 auto 0 0; background: var(--tone); opacity: 0.82;
    border-radius: var(--radius-sharp); transition: width 0.45s cubic-bezier(0.3,0,0.2,1); }
  .b-fill.muted { opacity: 0.32; }
  .b-thresh { position: absolute; top: -2px; bottom: -2px; width: 0; border-left: 2px dashed var(--fg-3); z-index: 2; }
  .b-val { position: relative; z-index: 1; margin-left: 9px; font-family: var(--er-mono);
    font-size: var(--fs-label-xs); font-weight: 500; color: var(--fg); white-space: nowrap;
     }
  .b-note { grid-column: 2; font-size: var(--fs-label-xs); line-height: 1.45; color: var(--fg-3); }
  .th-key { display: flex; align-items: center; gap: 6px; margin: 3px 0 0;
    font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); }
  .th-dash { width: 15px; border-top: 2px dashed var(--fg-3); }

  @media (max-width: 560px) {
    .row { grid-template-columns: 1fr; }
    .b-lab { text-align: left; }
    .b-note { grid-column: 1; }
  }
  .bars:global([data-armed]) .b-fill { transform-origin: left; transform: scaleX(0); transition: transform 1.1s var(--er-ease), width 0.45s var(--er-ease); }
  .bars:global([data-armed][data-shown]) .b-fill { transform: none; }
</style>
