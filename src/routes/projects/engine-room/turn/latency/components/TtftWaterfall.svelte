<script lang="ts">
  // TtftWaterfall — the measured send path, drawn to scale. The three site-code segments are
  // 87ms of 4.4 seconds; at true scale they are almost invisible, which is the entire point.
  // A magnify toggle exists because "you cannot see them" is the finding, not a rendering bug.
  import { WATERFALL, TTFT_TOTAL } from '../../../lib/tools';

  let magnify = $state(false);

  const siteMs = WATERFALL.filter((s) => s.kind === 'site').reduce((a, s) => a + s.ms, 0);
  const sitePct = (siteMs / TTFT_TOTAL) * 100;

  // At true scale the site slivers round to nothing; magnified, they get a floor width so
  // they are readable, and the label says so plainly.
  const width = (ms: number) => {
    const real = (ms / TTFT_TOTAL) * 100;
    return magnify ? Math.max(real, 7) : real;
  };

  // The label states the segments in words, and says so when the bar is no longer to scale.
  const trackLabel = $derived(
    `The send path, ${WATERFALL.map((s) => `${s.label} ${s.ms} milliseconds`).join(', ')}.` +
      (magnify
        ? ` Drawn magnified: the site segments truly occupy ${sitePct.toFixed(1)} percent of the bar.`
        : ' Drawn to true scale.')
  );
</script>

<div class="wf">
  <div class="wf-head">
    <button class="mg" class:on={magnify} aria-pressed={magnify} onclick={() => (magnify = !magnify)}>
      magnify the slivers
    </button>
  </div>

  <div class="track" role="img" aria-label={trackLabel}>
    {#each WATERFALL as s}
      <div class="seg" class:site={s.kind === 'site'} class:model={s.kind === 'model'}
           style="width:{width(s.ms)}%" title="{s.label} — {s.ms}ms. {s.what}">
        <span class="s-lab">{s.label}</span>
        <span class="s-ms">{s.ms >= 1000 ? (s.ms / 1000).toFixed(1) + 's' : s.ms + 'ms'}</span>
      </div>
    {/each}
  </div>
  <div aria-live="polite">
    {#if magnify}
      <p class="scale-note">Not to scale. The first three really occupy {sitePct.toFixed(1)}% of the bar.</p>
    {/if}
  </div>

  <div class="split">
    <div class="sp site">
      <b>{siteMs} ms</b>
      <span>everything this site's own code does</span>
      <em>{sitePct.toFixed(1)}% of the wait</em>
    </div>
    <div class="sp model">
      <b>{((TTFT_TOTAL - siteMs) / 1000).toFixed(1)} s</b>
      <span>the model reading the prompt before it says anything</span>
      <em>{(100 - sitePct).toFixed(1)}% of the wait</em>
    </div>
  </div>

</div>

<style>
  .wf { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .wf-head { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .mg { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-primary); background: rgba(255,255,255,0.65);
    border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-sharp); padding: 5px 11px; cursor: pointer; }
  .mg.on { background: var(--accent); border-color: var(--accent); color: #fff; }

  .track { display: flex; height: 52px; border-radius: var(--radius-sharp); overflow: hidden; border: 1px solid rgba(28,22,17,0.16); }
  .seg { display: flex; flex-direction: column; justify-content: center; gap: 1px; padding: 0 6px; min-width: 0;
    border-right: 1px solid rgba(255,255,255,0.55); transition: width 0.35s cubic-bezier(0.3,0,0.2,1); overflow: hidden; }
  .seg:last-child { border-right: none; }
  .seg.site { background: rgba(14,91,102,0.3); }
  .seg.model { background: rgba(196,87,10,0.26); }
  .s-lab { font-family: var(--font-body); font-size: var(--fs-label-xs); font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-ms { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.65); white-space: nowrap; }

  .scale-note { margin: 6px 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.5; color: var(--accent); }

  .split { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin-top: 11px; }
  .sp { border-radius: var(--radius-sharp); padding: 11px 14px; display: flex; flex-direction: column; gap: 2px; }
  .sp.site { background: rgba(14,91,102,0.1); border-left: 3px solid var(--accent-ink); }
  .sp.model { background: rgba(196,87,10,0.09); border-left: 3px solid var(--accent); }
  .sp b { font-family: var(--font-mono); font-size: 22px; font-weight: 600; color: var(--text-primary); line-height: 1.05; }
  .sp span { font-size: var(--fs-label); line-height: 1.45; color: rgba(28,22,17,0.72); }
  .sp em { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); margin-top: 3px; }

</style>
