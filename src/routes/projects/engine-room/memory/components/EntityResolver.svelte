<script lang="ts">
  // EntityResolver — toggle the evidence and watch confidence cross the merge bar.
  //
  // Mirrors the real scoring function: the strongest PRIMARY signal sets a base confidence,
  // corroborating signals add to it under a cap, and a conflicting address multiplies it
  // down and holds it below the bar rather than discarding the pair.
  import { SIGNALS, PAIRS, AUTO_MERGE } from '../../lib/memory';

  let on = $state<string[]>(['token_subset', 'shared_neighbours']);
  let a = $state('Card ending 4021');
  let b = $state('Card *4021');
  let story = $state(PAIRS[0].story);

  const primaries = SIGNALS.filter((s) => s.kind === 'primary');
  const corroborating = SIGNALS.filter((s) => s.kind === 'corroborating');
  const negative = SIGNALS.filter((s) => s.kind === 'negative');

  function toggle(id: string) {
    const s = SIGNALS.find((x) => x.id === id)!;
    if (s.kind === 'primary') {
      // primaries are mutually exclusive — the strongest that applies wins
      on = on.includes(id) ? on.filter((x) => x !== id) : [...on.filter((x) => !primaries.some((p) => p.id === x)), id];
    } else {
      on = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
    }
    story = '';
  }

  function loadPair(p: typeof PAIRS[number]) {
    a = p.a; b = p.b; on = [...p.on]; story = p.story;
  }

  /** The scoring walk, in the same order the real one runs. */
  const trace = $derived.by(() => {
    const steps: Array<{ label: string; from: number; to: number; note: string }> = [];
    let c = 0;

    const prim = primaries.find((p) => on.includes(p.id));
    if (prim) {
      steps.push({ label: prim.label, from: 0, to: prim.base!, note: 'primary signal sets the base' });
      c = prim.base!;
    }

    if (on.includes('conflicting_email')) {
      const to = Math.min(c * 0.4, 0.5);
      steps.push({ label: 'Different addresses', from: c, to, note: 'multiplied down and capped below the bar' });
      c = to;
    }

    for (const s of corroborating) {
      if (!on.includes(s.id)) continue;
      if (!prim) {
        steps.push({ label: s.label, from: c, to: c, note: 'ignored — corroborates nothing on its own' });
        continue;
      }
      const to = Math.min(s.cap!, c + s.delta!);
      steps.push({ label: s.label, from: c, to, note: `+${s.delta} under a ${s.cap} ceiling` });
      c = to;
    }

    return { steps, confidence: c };
  });

  const confidence = $derived(trace.confidence);
  const merges = $derived(confidence >= AUTO_MERGE);
</script>

<div class="er">
  <div class="er-pairs">
    <span class="k">Try a real case</span>
    <div class="pr">
      {#each PAIRS as p}
        <button onclick={() => loadPair(p)} class:on={a === p.a && b === p.b}>{p.a} <em>vs</em> {p.b}</button>
      {/each}
    </div>
  </div>

  <div class="cards">
    <div class="card"><span class="c-k">Record A</span><b>{a}</b></div>
    <div class="joiner" class:merge={merges}>{merges ? '=' : '≠'}</div>
    <div class="card"><span class="c-k">Record B</span><b>{b}</b></div>
  </div>

  <div class="sigs">
    <div class="sig-grp">
      <span class="sg-lab">Name and address — strongest wins</span>
      <div class="sg-row">
        {#each primaries as s}
          <button class="sig" class:on={on.includes(s.id)} onclick={() => toggle(s.id)} title={s.what}>
            {s.label}<em>{s.base}</em>
          </button>
        {/each}
      </div>
    </div>
    <div class="sig-grp">
      <span class="sg-lab">Corroboration — adds, never decides</span>
      <div class="sg-row">
        {#each corroborating as s}
          <button class="sig corr" class:on={on.includes(s.id)} onclick={() => toggle(s.id)} title={s.what}>
            {s.label}<em>+{s.delta}</em>
          </button>
        {/each}
        {#each negative as s}
          <button class="sig neg" class:on={on.includes(s.id)} onclick={() => toggle(s.id)} title={s.what}>
            {s.label}<em>×0.4</em>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="gauge">
    <div class="g-track">
      <span class="g-fill" class:merge={merges} style="width:{confidence * 100}%"></span>
      <span class="g-bar" style="left:{AUTO_MERGE * 100}%"><i>merge bar · {AUTO_MERGE}</i></span>
    </div>
    <div class="g-read">
      <b class:merge={merges}>{confidence.toFixed(2)}</b>
      <span class="g-verdict" class:merge={merges}>
        {#if merges}Merged automatically overnight
        {:else if confidence > 0}Held for a human to decide
        {:else}No signal fired{/if}
      </span>
    </div>
  </div>

  {#if trace.steps.length}
    <ol class="trace">
      {#each trace.steps as s}
        <li>
          <span class="t-lab">{s.label}</span>
          <span class="t-num">{s.from.toFixed(2)} → <b>{s.to.toFixed(2)}</b></span>
          <span class="t-note">{s.note}</span>
        </li>
      {/each}
    </ol>
  {/if}

  {#if story}
    <p class="story">{story}</p>
  {/if}

  <p class="er-foot">
    Everything above is <b>algorithmic and explainable</b> — you can read why any two records were joined. A language
    model does get a vote, but only as a fallback where the rules find nothing, and its suggestion is a
    <i>possible</i> match rather than a merge. Getting this wrong is expensive in a way most bugs are not: merging two
    people who are not the same person destroys information that cannot be recovered by re-running anything.
  </p>
</div>

<style>
  .er { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .k, .sg-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-ink); }
  .er-pairs { margin-bottom: 11px; }
  .pr { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .pr button { font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; }
  .pr button em { font-style: normal; color: rgba(28,22,17,0.4); margin: 0 3px; }
  .pr button:hover { background: rgba(28,22,17,0.07); }
  .pr button.on { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }
  .pr button.on em { color: rgba(255,255,255,0.6); }

  .cards { display: grid; grid-template-columns: 1fr 44px 1fr; gap: 8px; align-items: center; margin-bottom: 12px; }
  .card { border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round); background: rgba(255,255,255,0.65); padding: 10px 13px; min-width: 0; }
  .c-k { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.45); }
  .card b { display: block; font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--text-primary); margin-top: 3px; word-break: break-word; }
  .joiner { text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 600; color: rgba(28,22,17,0.3); transition: color 0.2s; }
  .joiner.merge { color: #2d7a3a; }

  .sigs { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
  .sg-row { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
  .sig { display: inline-flex; align-items: baseline; gap: 5px; font-family: 'DM Sans', sans-serif; font-size: 11.5px;
    color: var(--text-primary); background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 10px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .sig em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.45); }
  .sig:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.34); }
  .sig.on { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }
  .sig.on em { color: rgba(255,255,255,0.7); }
  .sig.corr.on { background: #2d7a3a; border-color: #2d7a3a; }
  .sig.neg.on { background: #c44; border-color: #c44; }

  .gauge { margin-bottom: 10px; }
  .g-track { position: relative; height: 26px; border-radius: var(--radius-round); background: rgba(28,22,17,0.07);
    border: 1px solid rgba(28,22,17,0.14); overflow: visible; }
  .g-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: var(--radius-round); background: rgba(180,99,46,0.4); transition: width 0.25s, background 0.25s; }
  .g-fill.merge { background: rgba(45,122,58,0.42); }
  .g-bar { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--accent); }
  .g-bar i { position: absolute; left: 6px; top: -1px; font-style: normal; font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px; color: var(--accent); white-space: nowrap; }
  .g-read { display: flex; align-items: baseline; gap: 10px; margin-top: 6px; }
  .g-read b { font-family: 'JetBrains Mono', monospace; font-size: 20px; font-weight: 600; color: var(--accent); }
  .g-read b.merge { color: #2d7a3a; }
  .g-verdict { font-size: 12.5px; color: rgba(28,22,17,0.68); }
  .g-verdict.merge { color: #2d7a3a; font-weight: 500; }

  .trace { margin: 0 0 10px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .trace li { display: grid; grid-template-columns: minmax(120px,1fr) 110px 1.4fr; gap: 9px; align-items: baseline;
    padding: 5px 10px; border-radius: var(--radius-sharp); background: rgba(255,255,255,0.55); }
  .t-lab { font-size: 12px; color: var(--text-primary); }
  .t-num { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: rgba(28,22,17,0.55); }
  .t-num b { color: var(--text-primary); }
  .t-note { font-size: 11px; color: rgba(28,22,17,0.55); }

  .story { margin: 0 0 10px; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74);
    border-left: 3px solid var(--accent-ink); background: var(--accent-ink-tint-12);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; padding: 9px 13px; }
  .er-foot { margin: 0; font-size: 11.5px; line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 92ch; }
  .er-foot b { color: rgba(28,22,17,0.82); }

  @media (max-width: 620px) {
    .cards { grid-template-columns: 1fr; }
    .joiner { transform: rotate(90deg); }
    .trace li { grid-template-columns: 1fr; gap: 2px; }
  }
</style>
