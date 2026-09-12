<script lang="ts">
  // Slots 'so what' + open question + falsifier + pagination. Never end on a chart.
  import { say, type Depth, type Dual } from './study';
  let { soWhat, openQuestion, falsifier, next, nextLabel, prev, prevLabel, depth = 'research' }:
    { soWhat: Dual; openQuestion: Dual; falsifier: string;
      next?: string; nextLabel?: string; prev?: string; prevLabel?: string; depth?: Depth } = $props();
</script>

<div class="fs-close">
  <div>
    <span class="fs-margin-label">So what</span>
    <p class="fs-sowhat">{say(soWhat, depth)}</p>
    {#if next || prev}
      <div style="display:flex;align-items:center;gap:14px;margin-top:22px">
        {#if next}<a class="fs-next" href={next}>{nextLabel} →</a>{/if}
        {#if prev}<a class="fs-prev" href={prev}>← {prevLabel}</a>{/if}
      </div>
    {/if}
  </div>
  <aside class="fs-open">
    <span class="fs-margin-label" style="color:var(--accent)">Open question</span>
    <p style="font-size:var(--fs-label);line-height:1.55;margin:0;color:var(--text-secondary)">{say(openQuestion, depth)}</p>
    <span class="fs-falsifier">Would change my mind: {falsifier}</span>
  </aside>
</div>
