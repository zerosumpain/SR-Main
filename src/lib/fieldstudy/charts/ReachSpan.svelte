<script lang="ts">
  /**
   * One measure, one axis: how much of the thing the demonstrated part covers.
   *
   * A proportion is the whole content of this figure, so it is a single bar
   * against its own whole rather than two bars a reader has to divide in their
   * head. The covered span is direct-labelled and the remainder is labelled
   * too — an unlabelled remainder is how a proportion chart flatters itself.
   *
   * No categorical hue: there is one series, so the title names it and the
   * accent marks the measured part. A second colour here would imply a
   * comparison that is not being made.
   */
  type Span = { label: string; value: number; of: number; unit?: string; note?: string };

  let { data, unit }: { data?: unknown; unit?: string } = $props();

  const spans = $derived((data as { spans?: Span[] } | undefined)?.spans ?? []);
  const foot = $derived((data as { foot?: string } | undefined)?.foot ?? '');

  const fmt = (n: number) => n.toLocaleString('en-GB');
  const pct = (v: number, of: number) => (of > 0 ? (v / of) * 100 : 0);
  /** Under ~1.2% a bar is a hairline; floor the paint so the row still reads. */
  const paint = (v: number, of: number) => Math.max(pct(v, of), 0.8);
</script>

<div class="rs">
  {#each spans as s (s.label)}
    {@const p = pct(s.value, s.of)}
    <div class="rs-row">
      <div class="rs-head">
        <b class="rs-label">{s.label}</b>
        <span class="rs-figure">
          <span class="rs-val">{fmt(s.value)}</span>
          <span class="rs-of">of {fmt(s.of)} {s.unit ?? unit ?? ''}</span>
          <span class="rs-pct">{p < 1 ? p.toFixed(1) : Math.round(p)}%</span>
        </span>
      </div>
      <div class="rs-track" role="img" aria-label="{s.label}: {fmt(s.value)} of {fmt(s.of)}">
        <div class="rs-fill" style="width:{paint(s.value, s.of)}%"></div>
      </div>
      <div class="rs-rem">
        <span>Not covered</span>
        <span class="rs-rem-val">{fmt(Math.max(s.of - s.value, 0))}</span>
      </div>
      {#if s.note}<p class="rs-note">{s.note}</p>{/if}
    </div>
  {/each}
  {#if foot}<p class="rs-foot">{foot}</p>{/if}
</div>

<style>
  .rs { width: 100%; padding: 15px 16px 14px; display: grid; gap: 16px; }
  .rs-row { display: grid; gap: 5px; min-width: 0; }
  .rs-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap; }
  .rs-label { font-size: var(--fs-label); color: var(--text-primary); }
  .rs-figure { display: inline-flex; align-items: baseline; gap: 7px; }
  .rs-val {
    font-family: var(--font-mono); font-size: var(--fs-body-sm); font-weight: 600;
    font-variant-numeric: tabular-nums; color: var(--text-primary);
  }
  .rs-of { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .rs-pct {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-variant-numeric: tabular-nums;
    color: var(--accent); letter-spacing: 0.04em;
  }
  .rs-track {
    position: relative; height: 12px;
    background: rgba(26, 16, 8, 0.07);
    border: 1px solid var(--line-hair);
  }
  .rs-fill {
    position: absolute; inset: 0 auto 0 0;
    background: var(--accent);
    /* Rounded data-end, square origin. 2px rather than the 4px a chart would
       normally take: the field-study kit allows 0, 2px and 100px only, and the
       repo rule outranks the chart convention. */
    border-radius: 0 2px 2px 0;
    min-width: 3px;
  }
  .rs-rem {
    display: inline-flex; align-items: baseline; gap: 6px;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-ghost);
  }
  .rs-rem-val { font-variant-numeric: tabular-nums; color: var(--text-muted); text-transform: none; letter-spacing: 0; }
  .rs-note { margin: 3px 0 0; font-size: var(--fs-label-xs); line-height: 1.55; color: var(--text-muted); max-width: 76ch; }
  .rs-foot {
    margin: 2px 0 0; padding-top: 10px; border-top: 1px solid var(--line-hair);
    font-size: var(--fs-label-xs); line-height: 1.55; color: var(--text-muted); max-width: 78ch;
  }
</style>
