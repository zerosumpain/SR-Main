<script lang="ts">
  // CommitmentsLedger — "commissioned, not invented". The DfE's own white papers,
  // statutes and reviews are rendered as an append-only, hash-chained ledger: each
  // commitment is a signed row the model already answers. Filter chips reorder the
  // ledger by source type; a row expands to its full alignment + citation + the
  // journey beat it validates. Mirrors FlowsDiagram's Svelte-5 + scoped-style grammar.
  import {
    COMMITMENTS,
    COMMITMENT_META,
    SOURCE_TYPE_LABEL,
    BEAT_LABEL,
    TENSIONS,
    type Commitment,
  } from '../lib/model';

  let { eli = false }: { eli?: boolean } = $props();

  type SourceType = 'white-paper' | 'statute' | 'mais' | 'milburn';
  type Status = 'committed' | 'statute' | 'programme' | 'emerging';

  // filter state — 'all' or one of the four source types
  let filter = $state<'all' | SourceType>('all');
  let openWhat = $state<string | null>(null);

  const STATUS_META: Record<Status, { label: string; color: string }> = {
    committed: { label: 'COMMITTED', color: '#2f7d4f' },
    statute: { label: 'IN STATUTE', color: '#1c2f4a' },
    programme: { label: 'IN PROGRAMME', color: '#c4570a' },
    emerging: { label: 'EMERGING', color: '#7a5aa6' },
  };

  const SOURCE_TYPES: SourceType[] = ['white-paper', 'statute', 'mais', 'milburn'];

  // ledger order: filtered set first, grouped by source type so the chip acts as a
  // reorder as well as a filter.
  const rows = $derived.by<Commitment[]>(() => {
    const list = COMMITMENTS.filter(
      (c) => filter === 'all' || COMMITMENT_META[c.what].sourceType === filter,
    );
    const rank = (c: Commitment) => SOURCE_TYPES.indexOf(COMMITMENT_META[c.what].sourceType);
    return [...list].sort((a, b) => rank(a) - rank(b));
  });

  // a deterministic short "signature" for the gutter hash-chain motif — not real
  // crypto, just a stable visual fingerprint per commitment.
  function sig(seed: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    const hex = (h >>> 0).toString(16).padStart(8, '0');
    return hex.slice(0, 6);
  }

  function toggle(what: string) {
    openWhat = openWhat === what ? null : what;
  }

  const CENTRAL_TENSION = TENSIONS.find((t) => t.title === 'Centralise-and-link vs federate');
  const total = COMMITMENTS.length;
  const shown = $derived(rows.length);
</script>

<section class="ledger-block">
  <header class="lb-head">
    <span class="lb-eyebrow">THE ALIGNMENT LEDGER</span>
    <h2>Commissioned, not invented</h2>
    <p class="lb-lead">
      The white papers and reviews don't undercut the model — they <em>commission</em> it.
      Every line below is a DfE commitment already on the record; the federated design is
      simply how the model answers it.
    </p>
  </header>

  <!-- filter chips: source type reorders / filters the ledger -->
  <div class="chips" role="group" aria-label="Filter the ledger by source type">
    <button
      class="chip"
      class:on={filter === 'all'}
      onclick={() => (filter = 'all')}
      title="Show every commitment"
      aria-pressed={filter === 'all'}
    >
      All sources <span class="chip-n">{total}</span>
    </button>
    {#each SOURCE_TYPES as st}
      {@const n = COMMITMENTS.filter((c) => COMMITMENT_META[c.what].sourceType === st).length}
      <button
        class="chip"
        class:on={filter === st}
        style="--chip:{STATUS_META[st === 'white-paper' ? 'committed' : st === 'statute' ? 'statute' : st === 'mais' ? 'programme' : 'emerging'].color}"
        onclick={() => (filter = st)}
        title="Filter to {SOURCE_TYPE_LABEL[st]} commitments"
        aria-pressed={filter === st}
      >
        {SOURCE_TYPE_LABEL[st]} <span class="chip-n">{n}</span>
      </button>
    {/each}
  </div>

  <!-- the ledger -->
  <div class="scroll">
    <div class="ledger" role="table" aria-label="DfE commitments and how the model answers them">
      <div class="l-colhead" role="row">
        <span class="lh lh-sig" role="columnheader">SIG</span>
        <span class="lh lh-what" role="columnheader">Commitment</span>
        <span class="lh lh-status" role="columnheader">Status</span>
        <span class="lh lh-source" role="columnheader">Source of record</span>
        <span class="lh lh-caret" role="columnheader" aria-label="Expand"></span>
      </div>

      {#each rows as c, i (c.what)}
        {@const meta = COMMITMENT_META[c.what]}
        {@const sm = STATUS_META[meta.status]}
        {@const isOpen = openWhat === c.what}
        <div class="l-row" class:open={isOpen} role="row">
          <button
            class="r-main"
            onclick={() => toggle(c.what)}
            aria-expanded={isOpen}
            title={isOpen ? 'Collapse' : 'Expand: how the model answers this'}
          >
            <!-- gutter hash-chain / signature -->
            <span class="r-sig" class:last={i === rows.length - 1}>
              <span class="sig-node" style="--sc:{sm.color}"></span>
              <span class="sig-hex">{sig(c.what)}</span>
            </span>

            <span class="r-what">{c.what}</span>

            <span class="r-status" role="cell">
              <span class="pill" style="--pc:{sm.color}">{sm.label}</span>
            </span>

            <span class="r-source">{c.source}</span>

            <span class="r-caret" aria-hidden="true">{isOpen ? '–' : '+'}</span>
          </button>

          {#if isOpen}
            <div class="r-detail" style="--dc:{sm.color}">
              <div class="d-align">
                <span class="d-label">HOW THE MODEL ANSWERS</span>
                <p>{c.align}</p>
              </div>
              <div class="d-meta">
                <div class="d-cite">
                  <span class="d-label">SOURCE CITATION</span>
                  <p>{c.source}</p>
                </div>
                <div class="d-beat">
                  <span class="d-label">VALIDATES</span>
                  <span class="beat-chip" style="--bc:{sm.color}">{BEAT_LABEL[meta.beat]}</span>
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <div class="l-foot">
    <span class="foot-count">{shown}/{total} entries</span>
    <span class="foot-note">append-only · signed · every commitment maps to a beat the model already walks</span>
  </div>

  <!-- the one contested tension, held as a highlighted callout -->
  {#if CENTRAL_TENSION}
    <aside class="tension" aria-label="Contested tension">
      <span class="t-flag">⚑ CONTESTED</span>
      <div class="t-body">
        <h3>{CENTRAL_TENSION.title}</h3>
        <p>{CENTRAL_TENSION.body}</p>
      </div>
    </aside>
  {/if}

  {#if eli}
    <p class="eli-note">
      Think of it as a receipt book. The government has already promised each of these things in
      writing. This model isn't inventing anything new — it's the tidy, tamper-proof way of keeping
      every one of those promises.
    </p>
  {/if}
</section>

<style>
  .ledger-block { display: flex; flex-direction: column; }

  .lb-head { margin-bottom: 16px; }
  .lb-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.22em; color: var(--accent-ink, #0e5b66); }
  .lb-head h2 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(22px, 2.6vw, 30px); color: var(--ink, #1a1008); margin: 4px 0 8px; }
  .lb-lead { font-family: 'DM Sans', sans-serif; font-size: 15px; line-height: 1.6; color: rgba(26,16,8,0.82); max-width: 62ch; margin: 0; }
  .lb-lead em { font-style: italic; color: var(--accent-ink, #0e5b66); font-weight: 600; }

  /* filter chips */
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .chip { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.04em; font-weight: 600;
    display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; cursor: pointer;
    border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-pill, 100px);
    background: #ffffff; color: rgba(26,16,8,0.72); --chip: var(--accent-ink, #0e5b66); }
  .chip:hover { border-color: var(--chip); color: var(--ink, #1a1008); }
  .chip.on { background: var(--chip); border-color: var(--chip); color: #ffffff; }
  .chip-n { font-size: 10px; padding: 1px 6px; border-radius: var(--radius-pill, 100px);
    background: rgba(26,16,8,0.1); color: inherit; }
  .chip.on .chip-n { background: rgba(255,255,255,0.24); }

  /* ledger frame */
  .scroll { overflow-x: auto; }
  .ledger { min-width: 720px; border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-round, 8px);
    overflow: hidden; background: var(--surface-elevated, #e8dece); }

  .l-colhead { display: grid; grid-template-columns: 96px minmax(190px, 1.5fr) 128px minmax(180px, 1.4fr) 34px;
    align-items: center; gap: 0; padding: 9px 4px 9px 0; background: var(--surface-elevated, #e8dece);
    border-bottom: 1.5px solid rgba(26,16,8,0.4); }
  .lh { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase;
    color: rgba(26,16,8,0.6); padding: 0 12px; }
  .lh-sig { padding-left: 14px; }
  .lh-caret { padding: 0; }

  /* rows */
  .l-row { border-bottom: 1px solid rgba(26,16,8,0.2); background: #ffffff; }
  .l-row:nth-child(even of .l-row) { background: #faf6ec; }
  .l-row:last-child { border-bottom: none; }
  .l-row.open { background: #ffffff; }

  .r-main { width: 100%; display: grid;
    grid-template-columns: 96px minmax(190px, 1.5fr) 128px minmax(180px, 1.4fr) 34px;
    align-items: center; gap: 0; padding: 0; border: none; background: transparent; cursor: pointer; text-align: left; }
  .r-main:hover { background: rgba(14,91,102,0.05); }
  .r-main:focus-visible { outline: 2px solid var(--accent-ink, #0e5b66); outline-offset: -2px; }

  /* gutter hash-chain */
  .r-sig { position: relative; display: flex; align-items: center; gap: 8px; padding: 16px 12px 16px 14px; min-height: 100%; }
  .sig-node { position: relative; flex: 0 0 10px; width: 10px; height: 10px; border-radius: 50%;
    background: var(--sc); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc) 22%, transparent); }
  /* the chain line linking every signature down the gutter */
  .r-sig::before { content: ''; position: absolute; left: 18px; top: -50%; height: 50%; width: 2px;
    background: rgba(26,16,8,0.25); }
  .r-sig::after { content: ''; position: absolute; left: 18px; top: 50%; height: 60%; width: 2px;
    background: rgba(26,16,8,0.25); }
  .r-sig.last::after { display: none; }
  .sig-hex { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.06em;
    color: rgba(26,16,8,0.6); }

  .r-what { font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 14px; line-height: 1.4;
    color: var(--ink, #1a1008); padding: 14px 12px; }
  .r-status { padding: 14px 12px; }
  .pill { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em;
    white-space: nowrap; padding: 4px 9px; border-radius: var(--radius-pill, 100px);
    color: var(--pc); border: 1.5px solid var(--pc); background: color-mix(in srgb, var(--pc) 10%, #ffffff); }
  .r-source { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; line-height: 1.5;
    color: rgba(26,16,8,0.72); padding: 14px 12px; }
  .r-caret { font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 500;
    color: rgba(26,16,8,0.6); text-align: center; padding: 0 4px; }
  .l-row.open .r-caret { color: var(--accent-ink, #0e5b66); }

  /* expanded detail */
  .r-detail { display: grid; grid-template-columns: 1.6fr 1fr; gap: 18px;
    padding: 4px 20px 20px 34px; border-top: 1px dashed rgba(26,16,8,0.28);
    border-left: 4px solid var(--dc); margin: 0 0 0 0; background: #ffffff; }
  .d-label { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.16em;
    color: rgba(26,16,8,0.6); display: block; margin: 14px 0 6px; }
  .d-align p, .d-cite p { font-family: 'DM Sans', sans-serif; font-size: 13.5px; line-height: 1.6;
    color: rgba(26,16,8,0.82); margin: 0; }
  .d-cite p { font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.55; color: rgba(26,16,8,0.72); }
  .d-meta { display: flex; flex-direction: column; }
  .beat-chip { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600;
    letter-spacing: 0.04em; padding: 6px 11px; border-radius: var(--radius-pill, 100px);
    color: var(--bc); border: 1.5px solid var(--bc); background: color-mix(in srgb, var(--bc) 9%, #ffffff); align-self: flex-start; }

  /* footer */
  .l-foot { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 12px 2px 0; }
  .foot-count { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
    letter-spacing: 0.06em; color: var(--ink, #1a1008); }
  .foot-note { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(26,16,8,0.6); }

  /* contested tension callout */
  .tension { display: flex; gap: 14px; align-items: flex-start; margin-top: 20px;
    border: 1.5px solid rgba(26,16,8,0.4); border-left: 5px solid #8a2d3a;
    border-radius: var(--radius-round, 8px); background: #faf6ec; padding: 16px 18px; }
  .t-flag { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 700; letter-spacing: 0.12em;
    color: #8a2d3a; white-space: nowrap; padding: 4px 9px; border: 1.5px solid #8a2d3a;
    border-radius: var(--radius-pill, 100px); background: color-mix(in srgb, #8a2d3a 8%, #ffffff); margin-top: 2px; }
  .t-body h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 17px; color: var(--ink, #1a1008); margin: 0 0 5px; }
  .t-body p { font-family: 'DM Sans', sans-serif; font-size: 13.5px; line-height: 1.6; color: rgba(26,16,8,0.82); margin: 0; }

  .eli-note { font-family: 'DM Sans', sans-serif; font-size: 13px; font-style: italic;
    color: rgba(26,16,8,0.72); margin: 16px 2px 0; line-height: 1.55; }

  @media (max-width: 720px) {
    .r-detail { grid-template-columns: 1fr; gap: 8px; }
  }
</style>
