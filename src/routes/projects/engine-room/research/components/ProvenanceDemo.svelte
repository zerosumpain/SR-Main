<script lang="ts">
  // ProvenanceDemo — the same three sources, composed two ways. One produces a claim that
  // exists in none of them; the other cannot, because every sentence has to carry a source.
  import { SOURCES, MERGED, EXTRACTED, GAPS } from '../../lib/research';

  let mode = $state<'merge' | 'facts'>('merge');
  const nameOf = (id: string) => SOURCES.find((s) => s.id === id)?.name.split(' — ')[0] ?? id;
</script>

<div class="pd">
  <div class="pd-srcs">
    <span class="k">Three sources</span>
    <div class="srcs">
      {#each SOURCES as s}
        <div class="src">
          <b>{s.name}</b>
          <ul>{#each s.claims as c}<li>{c}</li>{/each}</ul>
        </div>
      {/each}
    </div>
  </div>

  <div class="pd-switch" role="group" aria-label="Composition strategy">
    <button class:on={mode === 'merge'} onclick={() => (mode = 'merge')}>
      <b>Merge, then summarise</b><span>the obvious approach</span>
    </button>
    <button class:on={mode === 'facts'} onclick={() => (mode = 'facts')}>
      <b>Extract facts, then compose</b><span>what it does now</span>
    </button>
  </div>

  {#if mode === 'merge'}
    <div class="out bad">
      <span class="o-lab">The answer</span>
      {#each MERGED as m}
        <div class="line" class:bad={m.status === 'invented'}>
          <p class="l-text">{m.text}</p>
          <span class="l-src">no source recorded</span>
          <p class="l-note">{m.note}</p>
        </div>
      {/each}
      <p class="o-verdict">Every sentence reads well and two of the three are true. The third is in <b>none</b> of the
        sources — two nearby facts have been fused into a causal claim nobody made. And because provenance was
        destroyed at the merge, there is no way to tell the invented sentence from the true ones by looking at it.</p>
    </div>
  {:else}
    <div class="out good">
      <span class="o-lab">The facts</span>
      {#each EXTRACTED as f}
        <div class="line">
          <p class="l-text">{f.text}</p>
          <span class="l-src ok">{f.from.map(nameOf).join(' + ')}{f.from.length > 1 ? ' — corroborated' : ''}</span>
        </div>
      {/each}
      <span class="o-lab gap">What no source says</span>
      <ul class="gaps">{#each GAPS as g}<li>{g}</li>{/each}</ul>
      <p class="o-verdict">The causal claim cannot appear, because there is no source to attach it to. What is
        missing is stated <b>explicitly</b> rather than being quietly filled in — which is the actual fix. A model
        asked to write a summary will bridge a gap; a model asked to list facts and then list gaps has somewhere to
        put the gap that is not the summary.</p>
    </div>
  {/if}
</div>

<style>
  .pd { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .k, .o-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-ink); }
  .srcs { display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 9px; margin: 6px 0 13px; }
  .src { border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.6); padding: 9px 12px; }
  .src b { font-family: 'DM Sans', sans-serif; font-size: 11.5px; font-weight: 600; color: var(--text-primary); }
  .src ul { margin: 5px 0 0; padding-left: 15px; }
  .src li { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.68); margin-bottom: 3px; }

  .pd-switch { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 12px; }
  .pd-switch button { display: flex; flex-direction: column; gap: 1px; text-align: left; cursor: pointer; flex: 1 1 190px;
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); padding: 8px 13px; }
  .pd-switch b { font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
  .pd-switch span { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.55); }
  .pd-switch button:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.36); }
  .pd-switch button.on { background: var(--accent-ink); border-color: var(--accent-ink); }
  .pd-switch button.on b, .pd-switch button.on span { color: #fff; }

  .out { border-radius: var(--radius-round); padding: 12px 14px; border: 1px solid rgba(28,22,17,0.16); }
  .out.bad { background: rgba(196,68,68,0.05); border-color: rgba(196,68,68,0.26); }
  .out.good { background: rgba(45,122,58,0.05); border-color: rgba(45,122,58,0.28); }
  .o-lab.gap { color: var(--accent); display: block; margin-top: 12px; }

  .line { padding: 8px 0; border-bottom: 1px solid rgba(28,22,17,0.08); }
  .line:last-of-type { border-bottom: none; }
  .line.bad { background: rgba(196,68,68,0.07); border-radius: var(--radius-sharp); padding: 8px 10px; margin: 4px 0; }
  .l-text { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--text-primary); }
  .l-src { display: inline-block; margin-top: 4px; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    color: #c44; background: rgba(196,68,68,0.1); padding: 1px 6px; border-radius: var(--radius-sharp); }
  .l-src.ok { color: #2d7a3a; background: rgba(45,122,58,0.12); }
  .l-note { margin: 5px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.6); font-style: italic; }

  .gaps { margin: 6px 0 0; padding-left: 17px; }
  .gaps li { font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.7); margin-bottom: 3px; }

  .o-verdict { margin: 11px 0 0; padding-top: 9px; border-top: 1px solid rgba(28,22,17,0.1);
    font-size: 12.5px; line-height: 1.58; color: rgba(28,22,17,0.76); max-width: 88ch; }
  .o-verdict b { color: var(--text-primary); }
</style>
