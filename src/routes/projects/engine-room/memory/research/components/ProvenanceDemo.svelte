<script lang="ts">
  // ProvenanceDemo — three sources, composed two ways. The merge produces a sentence that is
  // in none of them; the facts-first pass cannot, because every line has to carry a source.
  //
  // Deliberately almost wordless: the constants' longer notes ride on title attributes rather
  // than being printed, because the argument here is a *shape* — red unattributed lines on one
  // side, green sourced lines plus an explicit gap list on the other.
  import { SOURCES, MERGED, EXTRACTED, GAPS } from '../../../lib/research';

  let mode = $state<'merge' | 'facts'>('merge');

  const SRCS = SOURCES.map((s) => {
    const [who, kind] = s.name.split(' — ');
    return { id: s.id, who, kind: kind ?? '', claims: s.claims };
  });
  const whoOf = (id: string) => SRCS.find((s) => s.id === id)?.who ?? id;

  const invented = MERGED.filter((m) => m.status === 'invented').length;
</script>

<div class="pd">
  <span class="k">Three sources</span>
  <div class="srcs">
    {#each SRCS as s (s.id)}
      <div class="src">
        <b>{s.who}</b><em>{s.kind}</em>
        <ul>{#each s.claims as c (c)}<li>{c}</li>{/each}</ul>
      </div>
    {/each}
  </div>

  <div class="pd-switch" role="group" aria-label="Composition strategy">
    <button class:on={mode === 'merge'} aria-pressed={mode === 'merge'} onclick={() => (mode = 'merge')}>
      <b>Merge, then summarise</b><span>obvious</span>
    </button>
    <button class:on={mode === 'facts'} aria-pressed={mode === 'facts'} onclick={() => (mode = 'facts')}>
      <b>Extract facts, then compose</b><span>used here</span>
    </button>
  </div>

  <div class="out" class:bad={mode === 'merge'} class:good={mode === 'facts'} aria-live="polite">
    {#if mode === 'merge'}
      <span class="o-lab">The answer</span>
      {#each MERGED as m (m.text)}
        <div class="line" class:bad={m.status === 'invented'} title={m.note}>
          <p class="l-text">{m.text}</p>
          <span class="chips">
            <span class="chip no">unattributed</span>
            {#if m.status === 'invented'}<span class="chip inv">not in any source</span>{/if}
          </span>
        </div>
      {/each}
      <p class="verdict" role="img" aria-label="{invented} of {MERGED.length} sentences is in none of the sources, and none of the {MERGED.length} carries a source.">
        <span class="v-n">{invented}/{MERGED.length}</span> invented · <span class="v-n">0/{MERGED.length}</span> traceable
      </p>
    {:else}
      <span class="o-lab">The facts</span>
      {#each EXTRACTED as f (f.text)}
        <div class="line">
          <p class="l-text">{f.text}</p>
          <span class="chips">
            <span class="chip ok">{f.from.map(whoOf).join(' + ')}</span>
            {#if f.from.length > 1}<span class="chip corr">corroborated</span>{/if}
            <span class="chip conf" data-c={f.conf}>{f.conf}</span>
          </span>
        </div>
      {/each}
      <span class="o-lab gap">What no source says</span>
      <ul class="gaps">{#each GAPS as g (g)}<li>{g}</li>{/each}</ul>
      <p class="verdict" role="img" aria-label="0 of {EXTRACTED.length} facts is invented, and all {EXTRACTED.length} carry a source.">
        <span class="v-n">0/{EXTRACTED.length}</span> invented · <span class="v-n">{EXTRACTED.length}/{EXTRACTED.length}</span> traceable
      </p>
    {/if}
  </div>
</div>

<style>
  .pd { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .k, .o-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent); }

  .srcs { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 7px; margin-bottom: 6px; }
  .src { border: 1px solid rgba(28,22,17,0.14); border-top: 2px solid rgba(28,22,17,0.28);
    border-radius: var(--radius-round); background: rgba(255,255,255,0.6); padding: 8px 11px; min-width: 0; }
  .src b { display: block; font-size: 11.5px; font-weight: 600; color: var(--text-primary); }
  .src em { display: block; font-style: normal; font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px; letter-spacing: 0.04em; color: rgba(28,22,17,0.5); margin-top: 1px; }
  .src ul { margin: 6px 0 0; padding-left: 14px; }
  .src li { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.7); margin-bottom: 3px; }

  .pd-switch { display: flex; gap: 6px; flex-wrap: wrap; }
  .pd-switch button { display: flex; flex-direction: column; gap: 1px; text-align: left; cursor: pointer;
    flex: 1 1 175px; min-width: 0; font-family: inherit; padding: 7px 12px;
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2);
    border-radius: var(--radius-round); transition: background 0.13s, border-color 0.13s; }
  .pd-switch b { font-size: 12.5px; font-weight: 600; color: var(--text-primary); line-height: 1.25; }
  .pd-switch span { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.55); }
  .pd-switch button:hover { background: rgba(255,255,255,0.95); border-color: rgba(28,22,17,0.38); }
  .pd-switch button.on { background: var(--accent); border-color: var(--accent); }
  .pd-switch button.on b, .pd-switch button.on span { color: #fff; }

  .out { border-radius: var(--radius-round); padding: 10px 13px 11px; border: 1px solid rgba(28,22,17,0.16); }
  .out.bad { background: color-mix(in srgb, var(--error) 5%, transparent);
    border-color: color-mix(in srgb, var(--error) 26%, transparent); }
  .out.good { background: color-mix(in srgb, var(--success) 5%, transparent);
    border-color: color-mix(in srgb, var(--success) 28%, transparent); }
  .o-lab.gap { display: block; margin-top: 11px; color: rgba(28,22,17,0.55); }

  .line { padding: 7px 0; border-bottom: 1px solid rgba(28,22,17,0.08); }
  .line:last-of-type { border-bottom: none; }
  .line.bad { background: color-mix(in srgb, var(--error) 9%, transparent); border-radius: var(--radius-sharp);
    border-bottom: none; border-left: 3px solid var(--error); padding: 7px 10px; margin: 4px 0; }
  .l-text { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--text-primary); }

  .chips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 4px; }
  .chip { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.04em;
    padding: 2px 6px; border-radius: var(--radius-sharp); white-space: nowrap; }
  .chip.no { color: var(--error); background: color-mix(in srgb, var(--error) 10%, transparent); }
  .chip.inv { color: #fff; background: var(--error); }
  .chip.ok { color: var(--success); background: color-mix(in srgb, var(--success) 13%, transparent); }
  .chip.corr { color: var(--success); background: transparent;
    border: 1px solid color-mix(in srgb, var(--success) 40%, transparent); }
  .chip.conf { color: rgba(28,22,17,0.6); background: rgba(28,22,17,0.07); }
  .chip.conf[data-c='high'] { color: var(--text-primary); background: rgba(28,22,17,0.13); }

  .gaps { margin: 5px 0 0; padding-left: 16px; }
  .gaps li { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.68); margin-bottom: 2px; }

  .verdict { display: flex; align-items: baseline; gap: 6px; margin: 9px 0 0; padding-top: 8px;
    border-top: 1px solid rgba(28,22,17,0.12); font-family: 'JetBrains Mono', monospace;
    font-size: 10px; letter-spacing: 0.04em; color: rgba(28,22,17,0.55); }
  .v-n { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .out.bad .v-n { color: var(--error); }
  .out.good .v-n { color: var(--success); }

  @media (max-width: 420px) {
    .srcs { grid-template-columns: 1fr; }
  }
</style>
