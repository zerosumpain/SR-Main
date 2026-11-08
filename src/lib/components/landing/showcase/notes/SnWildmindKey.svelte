<svelte:options css="injected" />

<script lang="ts">
  // The Wildmind map's key, under the scale bar in the label's mono: a swatch
  // and a word for each mark the map doesn't explain itself (keyItems in
  // showcase-notes-wildmind.ts decides which; the people and the crosses are
  // named where they stand). The swatches use the map's own --wm-* colours
  // from the figure. Hidden from screen readers: the caption is the map in
  // words.
  let { items }: { items: Array<{ cls: string; words: string }> } = $props();
</script>

<ul class="wm-key" aria-hidden="true">
  {#each items as k (k.cls)}<li><i data-k={k.cls}></i>{k.words}</li>{/each}
</ul>

<!--
  Style notes, kept out of <style>: this component is in a lazy view chunk
  (css="injected"), where comments in the CSS would ship to every reader.
  - .wm-key i[data-k='unseen']: The paper they haven't seen: the page's own ruled paper, edged
    by the broken line.
  - .wm-key i[data-k='camp']: A camp: a ring of fence with two huts in it, as the map draws one.
-->

<style>
  .wm-key {
    display: flex;
    flex-wrap: wrap;
    column-gap: 20px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 32px;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
  }
  .wm-key li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .wm-key i {
    display: inline-block;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border: 1.5px solid var(--text-ghost);
  }
  .wm-key i[data-k='wood'] {
    background:
      repeating-linear-gradient(45deg, color-mix(in srgb, var(--good) 55%, transparent) 0 1.2px, transparent 1.2px 4px),
      var(--wm-wood);
  }
  .wm-key i[data-k='wet'] {
    background:
      linear-gradient(to bottom, var(--wm-wet) 50%, transparent 50% 80%, var(--wm-wet) 80%),
      repeating-linear-gradient(90deg, var(--good) 0 1px, transparent 1px 3.5px),
      var(--wm-wet);
  }
  .wm-key i[data-k='fresh'] {
    background: var(--wm-fresh);
  }
  .wm-key i[data-k='sea'] {
    background: var(--wm-sea);
  }
  .wm-key i[data-k='shore'] {
    background: var(--wm-shore);
  }
  .wm-key i[data-k='high'] {
    background:
      repeating-linear-gradient(45deg, color-mix(in srgb, var(--text-primary) 35%, transparent) 0 1px, transparent 1px 4px),
      repeating-linear-gradient(-45deg, color-mix(in srgb, var(--text-primary) 35%, transparent) 0 1px, transparent 1px 4px),
      var(--wm-high);
  }
  .wm-key i[data-k='unseen'] {
    border: 1px dashed var(--text-muted);
    background: linear-gradient(to bottom, transparent 6px, var(--rule, var(--text-ghost)) 6px 7px, transparent 7px), var(--bg);
  }
  .wm-key i[data-k='camp'] {
    width: 16px;
    height: 14px;
    border: 1.3px solid var(--text-secondary);
    border-radius: 100px;
    background:
      linear-gradient(var(--text-secondary), var(--text-secondary)) 3px 2.5px / 3px 3px no-repeat,
      linear-gradient(var(--text-secondary), var(--text-secondary)) 7.5px 6px / 3px 3px no-repeat,
      var(--surface-card);
  }
  .wm-key i[data-k='hut'] {
    width: 8px;
    height: 8px;
    margin: 3px;
    border: 0;
    background: var(--text-secondary);
  }
  .wm-key i[data-k='animal'] {
    width: 6px;
    height: 6px;
    margin: 4px;
    border: 0;
    border-radius: 100px;
    background: var(--text-muted);
  }
  @media (max-width: 760px) {
    .wm-key {
      column-gap: 16px;
    }
  }
</style>
