<script lang="ts">
  // RecallBench — one retrieval, run in front of the reader.
  //
  // Three ways to ask the build-history graph a question, from lib/lessons.ts DEMO. The
  // paths are stand-ins (the study publishes no real ones); the shape of the answer and
  // the latencies are the measured production figures. Nothing here calls anything: a
  // public page must not couple to the private system it describes.
  import { DEMO } from '../../../lib/lessons';

  let { tone = '#8a2d3a' }: { tone?: string } = $props();

  let pick = $state(DEMO[0].id);
  const q = $derived(DEMO.find((d) => d.id === pick) ?? DEMO[0]);
</script>

<div class="rb" style="--tone:{tone}">
  <div class="chips" role="group" aria-label="What the build knows right now">
    {#each DEMO as d (d.id)}
      <button type="button" class="chip" class:on={pick === d.id} aria-pressed={pick === d.id}
              onclick={() => (pick = d.id)}>{d.label}</button>
    {/each}
  </div>

  <div class="q">
    <span class="q-lab">The query, exactly as the machine forms it</span>
    <code class="q-line">{q.query}</code>
    <p class="q-what">{q.what}</p>
  </div>

  <div class="serve" aria-live="polite">
    <div class="s-head">
      <span class="s-lab">What comes back</span>
      <span class="s-lat">{q.latency}</span>
    </div>
    {#each q.hits as h (h.title)}
      <div class="hit">
        <span class="h-kind" class:ep={h.kind === 'episode'}>{h.kind}</span>
        <div class="h-main">
          <b class="h-t">{h.title}</b>
          <span class="h-n">{h.note}</span>
        </div>
      </div>
    {/each}
  </div>

  <p class="foot">A worked example. The file names are inventions; the mechanism, the shape of the answer and the timings are the measured ones.</p>
</div>

<style>
  .rb { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { font-family: var(--font-body); font-size: var(--fs-label-xs); font-weight: 600; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-sharp); padding: 6px 12px; cursor: pointer; }
  .chip:hover { background: rgba(28,22,17,0.07); }
  .chip.on { background: var(--tone); border-color: var(--tone); color: #fff; }

  .q { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .q-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .q-line { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary);
    background: rgba(28,22,17,0.06); border-left: 3px solid var(--tone);
    padding: 7px 11px; border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    overflow-wrap: anywhere; }
  .q-what { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.68); }

  .serve { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.55); padding: 10px 13px; min-height: 8em; }
  .s-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    margin-bottom: 8px; }
  .s-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--tone); }
  .s-lat { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); }

  .hit { display: flex; gap: 10px; align-items: baseline; padding: 7px 0;
    border-top: 1px dashed rgba(28,22,17,0.14); }
  .hit:first-of-type { border-top: none; }
  .h-kind { flex-shrink: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--tone);
    background: color-mix(in srgb, var(--tone) 12%, transparent);
    padding: 2px 7px; border-radius: var(--radius-sharp); }
  .h-kind.ep { color: var(--accent-ink); background: color-mix(in srgb, var(--accent-ink) 12%, transparent); }
  .h-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .h-t { font-size: var(--fs-label); font-weight: 600; line-height: 1.35; color: var(--text-primary); }
  .h-n { font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.6); }

  .foot { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.5); }

  @media (max-width: 560px) { .serve { min-height: 0; } }
</style>
