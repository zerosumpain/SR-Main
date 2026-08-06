<script lang="ts">
  // Chunker — cut a real document into overlapping chunks and watch the boundaries move.
  //
  // The document is this section's own notes: the `why` on every retrieval and datastore
  // constant, plus the graph write-ups, joined into one passage. Nothing is invented — the
  // text is the study's own, and the only setting labelled "live" is the one in RETRIEVAL
  // (1,000 characters, 150 of overlap, the split nudged back to a sentence boundary).
  //
  // svelte5-pitfalls §1: there is no timer, no rAF and no observer here — every value is
  // derived from three pieces of state, so there is no handle to keep out of $state.
  import { RETRIEVAL, DATASTORE, GRAPH_FACTS } from '../../../lib/memory';

  const LIVE_SIZE = 1000;
  const LIVE_OVERLAP = 150;

  const PASSAGE = [
    ...RETRIEVAL.map((r) => r.why),
    ...DATASTORE.map((d) => d.why),
    ...GRAPH_FACTS.map((g) => g.body),
  ].join(' ');
  const N = PASSAGE.length;

  /** Sentence spans. A sentence ends at . ! or ? followed by whitespace, and the trailing
   *  whitespace belongs to the sentence that just ended — so a boundary is a clean cut. */
  function sentenceSpans(t: string) {
    const out: { start: number; end: number }[] = [];
    let start = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if ((c === '.' || c === '!' || c === '?') && (i + 1 >= t.length || /\s/.test(t[i + 1]))) {
        let e = i + 1;
        while (e < t.length && /\s/.test(t[e])) e++;
        out.push({ start, end: e });
        start = e;
      }
    }
    if (start < t.length) out.push({ start, end: t.length });
    return out;
  }
  const SENT = sentenceSpans(PASSAGE);
  const BOUNDS = SENT.map((s) => s.end);

  // ---- the three dials -----------------------------------------------------
  let size = $state(LIVE_SIZE);
  let overlap = $state(LIVE_OVERLAP);
  let nudge = $state(true);
  let sel = $state(0);

  const SIZE_MIN = 600, SIZE_MAX = 2000;
  const OVL_MIN = 0, OVL_MAX = 300;

  interface Chunk { start: number; end: number; raw: number; moved: number; severed: boolean }

  const chunks = $derived.by<Chunk[]>(() => {
    const out: Chunk[] = [];
    let start = 0;
    let guard = 0;
    while (start < N && guard++ < 24) {
      const raw = Math.min(start + size, N);
      let end = raw;
      if (nudge && raw < N) {
        let b = -1;
        for (const x of BOUNDS) {
          if (x > start && x <= raw) b = x;
          else if (x > raw) break;
        }
        if (b > 0) end = b;
      }
      out.push({ start, end, raw, moved: raw - end, severed: raw < N && end === raw && !BOUNDS.includes(raw) });
      if (end >= N) break;
      start = Math.max(end - overlap, start + 1);
    }
    return out;
  });

  const cuts = $derived(chunks.slice(0, -1).map((c, i) => ({ i, at: c.end, raw: c.raw, moved: c.moved, severed: c.severed })));
  const cut = $derived(cuts.length ? cuts[Math.min(sel, cuts.length - 1)] : null);

  const repeated = $derived(chunks.reduce((a, c, i) => (i === 0 ? 0 : a + Math.max(0, chunks[i - 1].end - c.start)), 0));
  const severedCount = $derived(chunks.filter((c) => c.severed).length);
  const live = $derived(size === LIVE_SIZE && overlap === LIVE_OVERLAP && nudge);

  /** The characters either side of the selected cut, so the nudge is legible. The moved
   *  span is elided in the middle past 72 characters — at a wide dial setting it can run to
   *  a sentence and a half, which would turn a readout into a paragraph. */
  const elide = (s: string) => (s.length <= 72 ? s : `${s.slice(0, 34)} … ${s.slice(-34)}`);
  const win = $derived.by(() => {
    if (!cut) return null;
    const a = Math.max(0, cut.at - 44);
    const b = Math.min(N, cut.raw + 44);
    return {
      lead: a > 0 ? '…' : '',
      before: PASSAGE.slice(a, cut.at),
      movedText: elide(PASSAGE.slice(cut.at, cut.raw)),
      after: PASSAGE.slice(cut.raw, b),
      trail: b < N ? '…' : '',
    };
  });

  const severedSent = $derived(new Set(chunks.filter((c) => c.severed).map((c) => SENT.findIndex((s) => c.raw > s.start && c.raw < s.end))));

  function reset() { size = LIVE_SIZE; overlap = LIVE_OVERLAP; nudge = true; }

  // ---- geometry (viewBox 1000 × 124) ---------------------------------------
  const W = 1000, H = 124;
  const DOC_Y = 14, DOC_H = 20;
  const L0 = 54, L1 = 78, LH = 20;
  const px = (c: number) => (c / N) * W;
  const fmt = (n: number) => n.toLocaleString('en-GB');
</script>

<div class="ck">
  <!-- ============ DIALS ============ -->
  <div class="ck-bar">
    <span class="badge" class:on={live}>{live ? 'the live setting' : 'what-if'}</span>
    <button class="reset" onclick={reset} disabled={live}>⟲ back to live</button>
  </div>

  <div class="dials">
    <div class="dial">
      <span class="d-k">Chunk size</span>
      <span class="d-v">{fmt(size)}<em>chars</em></span>
      <input type="range" min={SIZE_MIN} max={SIZE_MAX} step="50" bind:value={size}
             aria-label="Chunk size in characters" />
      <span class="d-tick" style="left:{((LIVE_SIZE - SIZE_MIN) / (SIZE_MAX - SIZE_MIN)) * 100}%">1,000</span>
    </div>

    <div class="dial">
      <span class="d-k">Overlap</span>
      <span class="d-v">{fmt(overlap)}<em>chars</em></span>
      <input type="range" min={OVL_MIN} max={OVL_MAX} step="25" bind:value={overlap}
             aria-label="Overlap between neighbouring chunks, in characters" />
      <span class="d-tick" style="left:{((LIVE_OVERLAP - OVL_MIN) / (OVL_MAX - OVL_MIN)) * 100}%">150</span>
    </div>

    <button class="tgl" class:on={nudge} aria-pressed={nudge} onclick={() => (nudge = !nudge)}>
      <span class="t-box" aria-hidden="true">{nudge ? '✓' : ''}</span>
      <span class="t-lab">Nudge back to a sentence boundary</span>
    </button>
  </div>

  <div class="chips">
    <span class="chip"><b>{chunks.length}</b>chunks</span>
    <span class="chip"><b>{fmt(repeated)}</b>chars in two chunks</span>
    <span class="chip" class:bad={severedCount > 0}><b>{severedCount}</b>cuts inside a sentence</span>
  </div>

  <!-- ============ THE STRIP ============ -->
  <div class="strip-scroll">
    <svg viewBox="0 0 {W} {H}" role="img"
      aria-label="A {fmt(N)}-character document of {SENT.length} sentences, cut into {chunks.length} chunks of {fmt(size)} characters with {fmt(overlap)} characters repeated between neighbours. {severedCount === 0 ? 'Every cut falls on the end of a sentence.' : `${severedCount} of ${cuts.length} cuts land inside a sentence.`}">

      <defs>
        <pattern id="er-ovl" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" class="hatch" />
        </pattern>
      </defs>

      <text x="0" y="8" class="lab">THE DOCUMENT · {fmt(N)} CHARACTERS · {SENT.length} SENTENCES, ONE PER BLOCK</text>

      {#each SENT as s, i (i)}
        <rect x={px(s.start)} y={DOC_Y} width={Math.max(px(s.end - s.start) - 0.9, 0.6)} height={DOC_H}
              class="sent" class:alt={i % 2 === 1} class:cutthrough={severedSent.has(i)} />
      {/each}

      <text x="0" y="48" class="lab">CHUNKS · LANES ALTERNATE TO SHOW OVERLAP</text>

      <!-- overlap bands, drawn under the chunk lanes -->
      {#each chunks as c, i (i)}
        {#if i > 0 && chunks[i - 1].end > c.start}
          <rect x={px(c.start)} y={L0 - 2} width={px(chunks[i - 1].end - c.start)} height={L1 + LH + 2 - (L0 - 2)} class="ovl" />
        {/if}
      {/each}

      {#each chunks as c, i (i)}
        {@const y = i % 2 === 0 ? L0 : L1}
        <rect x={px(c.start)} y={y} width={Math.max(px(c.end - c.start), 1)} height={LH} rx="3" class="chunk" />
        {#if px(c.end - c.start) > 26}
          <text x={px(c.start) + 5} y={y + 13.5} class="c-no">{i + 1}</text>
        {/if}
      {/each}

      <!-- where each cut landed, and where it would have landed -->
      {#each cuts as c (c.i)}
        {#if c.moved > 0}
          <line x1={px(c.raw)} y1={L0 - 6} x2={px(c.raw)} y2={L1 + LH + 6} class="rawcut" />
          <line x1={px(c.at)} y1={112} x2={px(c.raw)} y2={112} class="arrow" />
        {/if}
        <line x1={px(c.at)} y1={L0 - 6} x2={px(c.at)} y2={L1 + LH + 6} class="cut" class:sel={cut?.i === c.i} class:sev={c.severed} />
        <circle cx={px(c.at)} cy={L0 - 8} r={cut?.i === c.i ? 3.4 : 2} class="cut-dot" class:sel={cut?.i === c.i} class:sev={c.severed} />
      {/each}

      <text x="0" y={H - 2} class="key">SOLID = THE CUT · DASHED = THE RAW COUNT · HATCHED = TEXT IN BOTH CHUNKS</text>
    </svg>
  </div>

  <!-- ============ THE CUT, UP CLOSE ============ -->
  <div class="cutrow">
    <span class="k">Inspect a cut</span>
    {#each cuts as c (c.i)}
      <button class="cutb" class:on={cut?.i === c.i} class:sev={c.severed}
              aria-pressed={cut?.i === c.i} aria-label="Cut {c.i + 1}" onclick={() => (sel = c.i)}>{c.i + 1}</button>
    {/each}
  </div>

  {#if cut && win}
    <div class="zoom" class:sev={cut.severed}>
      <code class="z-text">{win.lead}{win.before}<span class="z-cut" aria-hidden="true"></span>{win.movedText}<span class="z-raw" class:hide={!win.movedText} aria-hidden="true"></span>{win.after}{win.trail}</code>
      <p class="z-say" aria-live="polite">
        {#if cut.severed}
          <b>Cut {cut.i + 1} lands inside a sentence.</b> That clause is whole in neither chunk.
        {:else if cut.moved > 0}
          <b>Cut {cut.i + 1} moved back {cut.moved} characters</b> — out of a clause, onto the end of a sentence.
        {:else}
          <b>Cut {cut.i + 1}</b> already fell on a sentence boundary.
        {/if}
      </p>
    </div>
  {/if}
</div>

<style>
  .ck { --tone: var(--accent); border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 12px 0 4px; }

  .ck-bar { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 10px; }
  .badge { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.13em; text-transform: uppercase;
    color: rgba(28,22,17,0.5); border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-pill); padding: 3px 10px; }
  .badge.on { color: #fff; background: var(--tone); border-color: var(--tone); }
  .reset { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-primary);
    background: rgba(255,255,255,0.65); border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-round);
    padding: 5px 11px; cursor: pointer; }
  .reset:hover:not(:disabled) { background: rgba(28,22,17,0.07); }
  .reset:disabled { opacity: 0.35; cursor: default; }

  .dials { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px 18px; align-items: end; }
  .dial { position: relative; display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; min-width: 0; }
  .d-k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--tone); align-self: end; }
  .d-v { font-family: 'JetBrains Mono', monospace; font-size: 15px; font-weight: 600; color: var(--text-primary); text-align: right; }
  .d-v em { font-style: normal; font-size: 9px; color: rgba(28,22,17,0.5); margin-left: 3px; }
  .dial input { grid-column: 1 / -1; width: 100%; margin: 3px 0 0; accent-color: var(--tone); }
  .d-tick { position: absolute; bottom: -12px; transform: translateX(-50%); white-space: nowrap;
    font-family: 'JetBrains Mono', monospace; font-size: 8px; color: rgba(28,22,17,0.5); }
  .d-tick::before { content: ''; position: absolute; left: 50%; top: -5px; width: 1px; height: 4px; background: rgba(28,22,17,0.4); }

  .tgl { display: flex; align-items: center; gap: 8px; text-align: left; cursor: pointer; font-family: inherit;
    padding: 8px 11px; border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.6); transition: background 0.13s, border-color 0.13s; }
  .tgl:hover { background: rgba(255,255,255,0.95); border-color: rgba(28,22,17,0.36); }
  .tgl.on { border-color: var(--tone); background: color-mix(in srgb, var(--tone) 9%, transparent); }
  .t-box { flex-shrink: 0; width: 15px; height: 15px; display: grid; place-items: center; font-size: 10px; color: #fff;
    border: 1px solid rgba(28,22,17,0.3); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.8); }
  .tgl.on .t-box { background: var(--tone); border-color: var(--tone); }
  .t-lab { font-size: 12px; line-height: 1.3; color: var(--text-primary); }

  .chips { display: flex; gap: 7px; flex-wrap: wrap; margin: 20px 0 8px; }
  .chip { display: inline-flex; align-items: baseline; gap: 5px; font-family: 'JetBrains Mono', monospace;
    font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(28,22,17,0.58);
    border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-pill); padding: 3px 11px; background: rgba(255,255,255,0.5); }
  .chip b { font-size: 13px; letter-spacing: 0; color: var(--text-primary); }
  .chip.bad { border-color: color-mix(in srgb, var(--tone) 55%, transparent); background: color-mix(in srgb, var(--tone) 9%, transparent); }
  .chip.bad b { color: var(--tone); }

  .strip-scroll { overflow-x: auto; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.5); padding: 8px 10px; }
  .strip-scroll svg { display: block; min-width: 540px; width: 100%; height: auto; }

  .lab { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; letter-spacing: 0.1em; fill: rgba(28,22,17,0.5); }
  .key { font-family: 'JetBrains Mono', monospace; font-size: 7px; letter-spacing: 0.08em; fill: rgba(28,22,17,0.42); }

  .sent { fill: rgba(28,22,17,0.14); }
  .sent.alt { fill: rgba(28,22,17,0.22); }
  .sent.cutthrough { fill: color-mix(in srgb, var(--tone) 45%, transparent); }

  .hatch { stroke: var(--tone); stroke-width: 2.4; opacity: 0.3; }
  .ovl { fill: url(#er-ovl); }
  .chunk { fill: color-mix(in srgb, var(--tone) 13%, transparent); stroke: color-mix(in srgb, var(--tone) 60%, transparent); stroke-width: 1; }
  .c-no { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; fill: color-mix(in srgb, var(--tone) 85%, #000); }

  .cut { stroke: var(--text-primary); stroke-width: 1.4; }
  .cut.sel { stroke-width: 2.6; }
  .cut.sev { stroke: var(--tone); }
  .cut-dot { fill: var(--text-primary); }
  .cut-dot.sev { fill: var(--tone); }
  .rawcut { stroke: rgba(28,22,17,0.45); stroke-width: 1.1; stroke-dasharray: 3 3; }
  .arrow { stroke: rgba(28,22,17,0.45); stroke-width: 1; }

  .cutrow { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin: 11px 0 8px; }
  .k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
    color: rgba(28,22,17,0.5); margin-right: 4px; }
  .cutb { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-primary); cursor: pointer;
    background: rgba(255,255,255,0.65); border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-round);
    min-width: 28px; padding: 4px 8px; }
  .cutb:hover { background: rgba(28,22,17,0.07); }
  .cutb.on { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg); }
  .cutb.sev { border-color: color-mix(in srgb, var(--tone) 60%, transparent); }
  .cutb.sev.on { background: var(--tone); border-color: var(--tone); color: #fff; }

  .zoom { border: 1px solid rgba(28,22,17,0.14); border-left: 3px solid var(--text-primary);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; background: rgba(255,255,255,0.6); padding: 10px 13px; }
  .zoom.sev { border-left-color: var(--tone); background: color-mix(in srgb, var(--tone) 6%, rgba(255,255,255,0.6)); }
  .z-text { display: block; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 1.85;
    color: rgba(28,22,17,0.72); overflow-wrap: anywhere; }
  .z-cut { display: inline-block; width: 0; height: 1.15em; vertical-align: -0.25em; margin: 0 2px;
    border-left: 2.5px solid var(--text-primary); }
  .zoom.sev .z-cut { border-left-color: var(--tone); }
  .z-raw { display: inline-block; width: 0; height: 1.15em; vertical-align: -0.25em; margin: 0 2px;
    border-left: 2px dashed rgba(28,22,17,0.5); }
  .z-raw.hide { display: none; }
  .z-say { margin: 7px 0 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.72);
    padding-top: 7px; border-top: 1px solid rgba(28,22,17,0.09); }
  .z-say b { color: var(--text-primary); }

  @media (max-width: 560px) {
    .ck { padding: 12px 12px; }
    .dials { grid-template-columns: 1fr; }
  }
</style>
