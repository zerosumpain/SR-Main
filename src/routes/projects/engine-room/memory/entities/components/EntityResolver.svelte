<script lang="ts">
  // EntityResolver — toggle the evidence and watch confidence cross the merge bar.
  //
  // Mirrors the real scoring function: the strongest PRIMARY signal sets a base confidence,
  // corroborating signals add to it under a cap, and a conflicting address overrules both —
  // holding the pair under the merge bar rather than discarding it. Every number shown comes
  // from SIGNALS or AUTO_MERGE; the source states no factor for the conflict, so none is
  // invented and the score is simply stopped at the bar.
  //
  // The four PAIRS are the worked cases this ladder was designed around, and they are the
  // entry point to the instrument — pick one, then start pulling evidence out of it. Their
  // names are deliberate neutral stand-ins and are read straight from the constant so they
  // can never drift here.
  import { SIGNALS, PAIRS, AUTO_MERGE } from '../../../lib/memory';

  let pairId = $state<string | null>(PAIRS[0].id);
  let on = $state<string[]>([...PAIRS[0].on]);
  let a = $state(PAIRS[0].a);
  let b = $state(PAIRS[0].b);
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
    // the evidence no longer matches the worked case it came from
    pairId = null;
    story = '';
  }

  function loadPair(p: typeof PAIRS[number]) {
    pairId = p.id; a = p.a; b = p.b; on = [...p.on]; story = p.story;
  }

  /** The scoring walk. Every number in it comes from SIGNALS or AUTO_MERGE — nothing else. */
  const trace = $derived.by(() => {
    const steps: Array<{ label: string; from: number; to: number; note: string }> = [];
    let c = 0;

    const prim = primaries.find((p) => on.includes(p.id));
    if (prim) {
      steps.push({ label: prim.label, from: 0, to: prim.base!, note: 'sets the base' });
      c = prim.base!;
    }

    for (const s of corroborating) {
      if (!on.includes(s.id)) continue;
      if (!prim) {
        steps.push({ label: s.label, from: c, to: c, note: 'ignored — corroborates nothing' });
        continue;
      }
      const to = Math.min(s.cap!, c + s.delta!);
      steps.push({ label: s.label, from: c, to, note: `+${s.delta}, ceiling ${s.cap}` });
      c = to;
    }

    // A conflicting address is applied last, and overrules. The constant states only what it
    // does — beats name similarity, and holds the pair under the bar rather than dropping it —
    // and gives no factor, so none is invented here: the score is stopped AT the bar and the
    // pair is flagged held. Applying it last also stops corroboration lifting it back over.
    // Nothing to overrule if no positive signal fired, so it stays out of the walk entirely.
    // The score itself is left alone. Capping it AT the bar would print 0.85 next to "does not
    // merge", contradicting the rule stated two elements away — and any figure below the bar
    // would be invented, since the constant gives no factor. So the evidence keeps the score
    // it earned, and the conflict is shown for what the source says it is: an overrule.
    const neg = c > 0 ? negative.find((s) => on.includes(s.id)) : undefined;
    if (neg) steps.push({ label: neg.label, from: c, to: c, note: 'overrules — held whatever the score' });

    return { steps, confidence: c, held: Boolean(neg) };
  });

  const confidence = $derived(trace.confidence);
  const merges = $derived(confidence >= AUTO_MERGE && !trace.held);
</script>

<div class="er">
  <div class="er-pairs">
    <span class="k" id="er-cases">Pick a case</span>
    <div class="pr" role="group" aria-labelledby="er-cases">
      {#each PAIRS as p (p.id)}
        <button type="button" onclick={() => loadPair(p)} class:on={pairId === p.id} aria-pressed={pairId === p.id}>
          {p.a} <em>vs</em> {p.b}
        </button>
      {/each}
    </div>
  </div>

  <div class="cards">
    <div class="card"><span class="c-k">Record A</span><b>{a}</b></div>
    <div class="joiner" class:merge={merges} aria-hidden="true">{merges ? '=' : '≠'}</div>
    <div class="card"><span class="c-k">Record B</span><b>{b}</b></div>
  </div>

  <div class="sigs">
    <div class="sig-grp">
      <span class="sg-lab" id="er-prim">Name and address — strongest wins</span>
      <div class="sg-row" role="group" aria-labelledby="er-prim">
        {#each primaries as s (s.id)}
          <button type="button" class="sig" class:on={on.includes(s.id)} aria-pressed={on.includes(s.id)}
                  onclick={() => toggle(s.id)} title={s.what}>
            {s.label}<em>{s.base}</em>
          </button>
        {/each}
      </div>
    </div>
    <div class="sig-grp">
      <span class="sg-lab" id="er-corr">Corroboration — adds, never decides</span>
      <div class="sg-row" role="group" aria-labelledby="er-corr">
        {#each corroborating as s (s.id)}
          <button type="button" class="sig corr" class:on={on.includes(s.id)} aria-pressed={on.includes(s.id)}
                  onclick={() => toggle(s.id)} title={s.what}>
            {s.label}<em>+{s.delta}</em>
          </button>
        {/each}
        {#each negative as s (s.id)}
          <button type="button" class="sig neg" class:on={on.includes(s.id)} aria-pressed={on.includes(s.id)}
                  onclick={() => toggle(s.id)} title={s.what}>
            {s.label}<em>overrules</em>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="gauge">
    <div class="g-track">
      <span class="g-fill" class:merge={merges} class:held={trace.held}
            style="width:{(trace.held ? Math.min(confidence, AUTO_MERGE) : confidence) * 100}%"></span>
      <span class="g-bar" style="left:{AUTO_MERGE * 100}%"><i>merge bar · {AUTO_MERGE}</i></span>
    </div>
    <div class="g-read" aria-live="polite">
      <b class:merge={merges}>{confidence.toFixed(2)}</b>
      <span class="g-verdict" class:merge={merges}>
        {#if merges}Merged unattended overnight
        {:else if trace.held}Overruled by the address conflict — held, not dropped
        {:else if confidence > 0}Held for a person to decide
        {:else}No signal fired{/if}
      </span>
    </div>
  </div>

  {#if trace.steps.length}
    <ol class="trace">
      {#each trace.steps as s (s.label)}
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
</div>

<style>
  /* No frame of its own — the Instrument wrapper supplies it. */
  .er { display: flow-root; min-width: 0; }
  .k, .sg-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .er-pairs { margin-bottom: 11px; }
  .pr { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .pr button { font-family: var(--font-body); font-size: var(--fs-label-xs); color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-sharp); padding: 5px 11px; cursor: pointer; }
  .pr button em { font-style: normal; color: rgba(28,22,17,0.4); margin: 0 3px; }
  .pr button:hover { background: rgba(28,22,17,0.07); }
  .pr button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .pr button.on em { color: rgba(255,255,255,0.6); }

  .cards { display: grid; grid-template-columns: 1fr 44px 1fr; gap: 8px; align-items: center; margin-bottom: 12px; }
  .card { border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.65); padding: 10px 13px; min-width: 0; }
  .c-k { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.45); }
  .card b { display: block; font-family: var(--fs-serif); font-size: var(--fs-body-sm); font-weight: 600;
    color: var(--text-primary); margin-top: 3px; word-break: break-word; }
  .joiner { text-align: center; font-family: var(--font-mono); font-size: 22px;
    font-weight: 600; color: rgba(28,22,17,0.3); transition: color 0.2s; }
  .joiner.merge { color: var(--success); }

  .sigs { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
  .sg-row { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
  .sig { display: inline-flex; align-items: baseline; gap: 5px; font-family: var(--font-body);
    font-size: var(--fs-label-xs); color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-sharp); padding: 5px 10px;
    cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .sig em { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.45); }
  .sig:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.34); }
  .sig.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .sig.on em { color: rgba(255,255,255,0.7); }
  .sig.corr.on { background: var(--accent-ink); border-color: var(--accent-ink); }
  .sig.neg.on { background: var(--error); border-color: var(--error); }

  .gauge { margin-bottom: 10px; }
  .g-track { position: relative; height: 26px; border-radius: var(--radius-sharp);
    background: rgba(28,22,17,0.07); border: 1px solid rgba(28,22,17,0.14); overflow: visible; }
  .g-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: var(--radius-sharp);
    background: color-mix(in srgb, var(--accent) 38%, transparent); transition: width 0.25s, background 0.25s; }
  .g-fill.merge { background: color-mix(in srgb, var(--success) 42%, transparent); }
  /* Overruled: the fill stops dead at the dashed bar rather than crossing it. */
  .g-fill.held { background: color-mix(in srgb, var(--error) 30%, transparent); }
  /* Same dashed rule as the threshold on the Bars chart below: one mark, one meaning. */
  .g-bar { position: absolute; top: -3px; bottom: -3px; width: 0; border-left: 2px dashed rgba(28,22,17,0.55); }
  .g-bar i { position: absolute; right: 6px; top: -1px; font-style: normal;
    font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); white-space: nowrap; }
  .g-read { display: flex; align-items: baseline; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
  .g-read b { font-family: var(--font-mono); font-size: 20px; font-weight: 600; color: var(--accent); }
  .g-read b.merge { color: var(--success); }
  .g-verdict { font-size: var(--fs-label); color: rgba(28,22,17,0.68); }
  .g-verdict.merge { color: var(--success); font-weight: 500; }

  .trace { margin: 0 0 10px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .trace li { display: grid; grid-template-columns: minmax(120px,1fr) 110px 1.4fr; gap: 9px; align-items: baseline;
    padding: 5px 10px; border-radius: var(--radius-sharp); background: rgba(255,255,255,0.55); }
  .t-lab { font-size: var(--fs-label-xs); color: var(--text-primary); }
  .t-num { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); }
  .t-num b { color: var(--text-primary); }
  .t-note { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); }

  .story { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74);
    border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; padding: 9px 13px; }

  @media (max-width: 620px) {
    .cards { grid-template-columns: 1fr; }
    .joiner { transform: rotate(90deg); }
    .trace li { grid-template-columns: 1fr; gap: 2px; }
  }
</style>
