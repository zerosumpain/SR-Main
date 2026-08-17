<script lang="ts">
  // QueryComposer — assemble a CGQL query and watch the string form.
  //
  // Pure display: nothing is executed, because a public page must not couple to the
  // private system it describes. The grammar, the caps and the defaults are the
  // shipped ones; the seed values are stand-ins.
  let { tone = '#8a2d3a' }: { tone?: string } = $props();

  const SEEDS = [
    { id: 'fingerprint', label: 'An error fingerprint', part: 'fingerprint:vitest:stream-order', what: 'The hot lane: the previous failure, reduced to a class. Exact key, plain index, no free text anywhere near it.' },
    { id: 'file', label: 'A set of files', part: 'file:chat/stream.ts,chat/send.ts', what: 'The files a build has in hand. Exact paths, glob allowed — the seed for a build that has not failed yet.' },
    { id: 'topic', label: 'Words', part: 'topic:"stream timeout"', what: 'The one free-text door, for a person asking rather than a build failing. Tokenised and scored, never matched as a whole phrase.' },
  ];
  const HOPS = [
    { id: 0, label: 'No walk', what: 'Only what the seed names directly.' },
    { id: 1, label: '1 hop', what: 'The seed plus its immediate neighbours — imports, co-changes, past failures.' },
    { id: 2, label: '2 hops', what: 'Two steps out. The hard cap: an unbounded walk over a connected graph is the whole database.' },
  ];

  let seed = $state('fingerprint');
  let hops = $state(1);
  let lessons = $state(true);
  let episodes = $state(true);
  let verified = $state(true);
  let budget = $state(5000);

  const chosenSeed = $derived(SEEDS.find((s) => s.id === seed) ?? SEEDS[0]);
  const chosenHops = $derived(HOPS.find((h) => h.id === hops) ?? HOPS[1]);

  const query = $derived.by(() => {
    const stages = [chosenSeed.part];
    if (hops > 0) stages.push(`hops ${hops}`);
    if (lessons) stages.push('lessons');
    if (episodes) stages.push(`episodes${verified ? ' verdict=verified' : ''} limit=3`);
    stages.push(`budget ${budget}`);
    return stages.join(' | ');
  });
</script>

<div class="qc" style="--tone:{tone}">
  <div class="row">
    <span class="row-lab">Start from</span>
    <div class="chips" role="group" aria-label="Seed">
      {#each SEEDS as s (s.id)}
        <button type="button" class="chip" class:on={seed === s.id} aria-pressed={seed === s.id}
                onclick={() => (seed = s.id)}>{s.label}</button>
      {/each}
    </div>
  </div>
  <div class="row">
    <span class="row-lab">Walk out</span>
    <div class="chips" role="group" aria-label="Hops">
      {#each HOPS as h (h.id)}
        <button type="button" class="chip" class:on={hops === h.id} aria-pressed={hops === h.id}
                onclick={() => (hops = h.id)}>{h.label}</button>
      {/each}
    </div>
  </div>
  <div class="row">
    <span class="row-lab">Collect</span>
    <div class="chips" role="group" aria-label="Picks">
      <button type="button" class="chip" class:on={lessons} aria-pressed={lessons}
              onclick={() => (lessons = !lessons)}>lessons</button>
      <button type="button" class="chip" class:on={episodes} aria-pressed={episodes}
              onclick={() => (episodes = !episodes)}>episodes</button>
      {#if episodes}
        <button type="button" class="chip sub" class:on={verified} aria-pressed={verified}
                onclick={() => (verified = !verified)}>verified only</button>
      {/if}
    </div>
  </div>
  <label class="row bud">
    <span class="row-lab">Budget <b>{budget.toLocaleString('en-GB')} chars</b></span>
    <input type="range" min="1000" max="8000" step="500" bind:value={budget} />
  </label>

  <div class="out">
    <span class="out-lab">The query, as the machine would write it</span>
    <code class="out-q" aria-live="polite">{query}</code>
    <p class="out-why">{chosenSeed.what} {chosenHops.what}</p>
  </div>
</div>

<style>
  .qc { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

  .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .row-lab { flex-shrink: 0; width: 92px; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .row-lab b { color: var(--text-primary); letter-spacing: 0; text-transform: none; }

  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { font-family: var(--font-body); font-size: var(--fs-label-xs); color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-sharp); padding: 5px 11px; cursor: pointer; }
  .chip:hover { background: rgba(28,22,17,0.07); }
  .chip.on { background: var(--tone); border-color: var(--tone); color: #fff; }
  .chip.sub { border-style: dashed; }

  .bud { cursor: pointer; }
  .bud input { flex: 1 1 180px; max-width: 340px; accent-color: var(--tone); }

  .out { display: flex; flex-direction: column; gap: 6px; margin-top: 4px;
    padding-top: 12px; border-top: 1px dashed rgba(28,22,17,0.18); }
  .out-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--tone); }
  .out-q { font-family: var(--font-mono); font-size: var(--fs-label); line-height: 1.5; color: var(--text-primary);
    background: rgba(28,22,17,0.06); border-left: 3px solid var(--tone);
    padding: 8px 12px; border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    overflow-wrap: anywhere; }
  .out-why { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.68); }
</style>
