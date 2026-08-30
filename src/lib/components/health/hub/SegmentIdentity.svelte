<script lang="ts">
  // 01 — IDENTITY. The dark deck a segment opens on.
  //
  // THE NAME IS THE HERO, AND IT TAKES THE BRAND VOICE, NOT THE DISPLAY ONE.
  // `curlew.ochre.holloway` is an identifier — it was generated from the
  // geometry's own seed and it is how this stretch is referred to everywhere
  // else on the site — so it is set in DM Mono 500, lowercase, with the
  // separators in accent. Archivo Black would make it a headline, which it is
  // not: it is a name.
  //
  // The five cards beneath each carry a footnote, because a time with no date
  // on it is a number nobody can place.
  import { activityLabel } from '$lib/trails/format';
  import { identityCells } from '$lib/health/segment-detail';
  import type { SegmentDetail } from '$lib/trails/segments-service';

  interface Props {
    segment: SegmentDetail;
    /** Unix seconds. Passed in so staleness and the page agree on "today". */
    nowS: number;
  }

  let { segment, nowS }: Props = $props();

  const parts = $derived(segment.name.split('.'));
  const cells = $derived(identityCells(segment, nowS));
</script>

<section class="si">
  <div class="si-inner">
    <p class="si-kicker">Derived name · living.matter.ground</p>

    <h1 class="si-title"
      >{#each parts as part, i (i)}{#if i > 0}<span class="si-dot">.</span>{/if}{part}{/each}</h1
    >

    <div class="si-line">
      <p class="si-desc">{segment.descriptor}</p>
      <span class="si-chip lit">{segment.terrain}</span>
      {#if segment.offroad}<span class="si-chip">Off-road · by sport</span>{/if}
      <span class="si-chip">{activityLabel(segment.activityType)}</span>
    </div>

    <div class="si-cells">
      {#each cells as cell (cell.key)}
        <div class="si-cell">
          <p class="si-label">{cell.label}</p>
          <p class="si-value" class:lit={cell.lit}>
            {cell.value}{#if cell.unit}<span class="si-unit">{cell.unit}</span>{/if}
          </p>
          {#if cell.sub}<p class="si-sub">{cell.sub}</p>{/if}
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .si {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(32px, 4vw, 60px) clamp(20px, 3vw, 44px) clamp(28px, 3.5vw, 44px);
  }
  .si-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .si-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    margin: 0 0 20px;
  }

  .si-title {
    font-family: var(--font-brand);
    font-weight: 500;
    font-size: clamp(32px, 5.6vw, 78px);
    line-height: 1.02;
    letter-spacing: -0.03em;
    text-transform: lowercase;
    word-break: break-word;
    margin: 0 0 22px;
  }
  .si-dot {
    color: var(--accent-on-dark);
  }

  .si-line {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 30px;
  }
  .si-desc {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    color: rgba(237, 228, 212, 0.8);
    margin: 0;
  }

  /* The one radius in this system that is not 0. */
  .si-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border: 1px solid rgba(237, 228, 212, 0.3);
    color: rgba(237, 228, 212, 0.8);
    border-radius: 100px;
    padding: 5px 13px;
  }
  .si-chip.lit {
    background: rgba(232, 134, 58, 0.16);
    border-color: rgba(232, 134, 58, 0.45);
    color: var(--accent-on-dark);
  }

  /* Each card carries its own border with a real gap. The `gap: 1px` over a
     painted container trick breaks on an auto-fit grid: when the resolved
     column count exceeds the item count, the unfilled tracks paint as blocks. */
  .si-cells {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }
  .si-cell {
    border: 1px solid rgba(237, 228, 212, 0.16);
    border-radius: 0;
    background: rgba(237, 228, 212, 0.05);
    padding: 18px;
    min-width: 0;
  }
  .si-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 0 0 10px;
  }
  .si-value {
    font-family: var(--font-display);
    font-size: 30px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .si-value.lit {
    color: var(--accent-on-dark);
  }
  .si-unit {
    font-size: var(--fs-nav);
    color: rgba(237, 228, 212, 0.45);
  }
  .si-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 10px 0 0;
  }
</style>
