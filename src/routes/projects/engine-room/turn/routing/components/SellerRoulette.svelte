<script lang="ts">
  // SellerRoulette — the central point of the Models section: naming a model does not
  // determine what you receive. Choose a sort and watch which seller you land on, and what
  // that costs you in precision and in wait.
  //
  // Prose here is deliberately thin. The framing sentence lives on the Instrument that wraps
  // this component; everything below is a control, a cell or a one-line readout.
  import { SELLERS, SELLER_FACTS, type Seller } from '../../../lib/models';

  type SortKey = 'price' | 'latency' | 'precision';
  let sort = $state<SortKey>('price');

  const SORTS: Array<{ k: SortKey; label: string }> = [
    { k: 'price', label: 'Cheapest per token' },
    { k: 'latency', label: 'Fastest first token' },
    { k: 'precision', label: 'Full precision first' },
  ];

  const ordered = $derived.by<Seller[]>(() => {
    const s = [...SELLERS];
    if (sort === 'price') return s.sort((a, b) => a.inPrice - b.inPrice);
    if (sort === 'latency') return s.sort((a, b) => a.ttft - b.ttft);
    return s.sort((a, b) => {
      const rank = (x: Seller) => (x.quant === 'fp8' ? 0 : x.quant === 'unknown' ? 1 : 2);
      return rank(a) - rank(b) || a.inPrice - b.inPrice;
    });
  });

  const winner = $derived(ordered[0]);
  const maxPrice = Math.max(...SELLERS.map((s) => s.inPrice));
  const maxTtft = Math.max(...SELLERS.map((s) => s.ttft));

  /** The sellers' own notes, compressed to a cell annotation. No fact changed.
   *  Seller C's note is dropped: the `unknown` precision cell already says it. */
  const NOTE: Record<string, string> = {
    'Seller A': "the naive sort's pick",
    'Seller E': 'full precision, fast, under the ceiling',
    'Seller F': 'dearest, not the fastest',
  };

  /** One line per strategy, describing THE ROW THE SORT ACTUALLY SELECTS — price → A,
   *  latency → E, precision → D. Every figure a reader needs is in the row itself, so no
   *  ratio is asserted here: an earlier draft quoted "thirty-five times faster" and "five
   *  tool round trips", neither of which exists in any constant, and its precision line
   *  described Seller E while the sort returns Seller D. */
  const VERDICT: Record<SortKey, string> = {
    price: 'A quarter-precision copy behind the longest queue. The score that picked it was measured at full precision.',
    latency: 'Full precision and the fastest first token, nowhere near the price ceiling. Cheap was costing time.',
    precision: 'The cheapest full-precision seller — and not the fastest. Precision and speed are priced apart.',
  };

  const QUANT_NOTE: Record<Seller['quant'], string> = {
    fp8: 'full precision',
    fp4: 'quantised to a quarter',
    unknown: 'precision not advertised',
  };
</script>

<div class="sr">
  <div class="sr-sorts" role="group" aria-label="Selection strategy">
    {#each SORTS as s}
      <button class:on={sort === s.k} aria-pressed={sort === s.k} onclick={() => (sort = s.k)}>{s.label}</button>
    {/each}
  </div>

  <div class="sr-tbl" role="table" aria-label="Sellers of one model, ordered by the selected strategy">
    <div class="row hd" role="row">
      <span role="columnheader">Seller</span>
      <span role="columnheader">Precision</span>
      <span role="columnheader">$/M in</span>
      <span role="columnheader">First token</span>
    </div>
    {#each ordered as s (s.id)}
      <div class="row" class:win={s.id === winner.id} role="row">
        <span class="nm" role="cell">
          {#if s.id === winner.id}<em aria-hidden="true">▸</em>{/if}{s.id}
          {#if NOTE[s.id]}<i>{NOTE[s.id]}</i>{/if}
        </span>
        <span class="q" role="cell" data-q={s.quant} title={QUANT_NOTE[s.quant]}
              aria-label="Precision: {QUANT_NOTE[s.quant]}">{s.quant}</span>
        <span class="bar" role="cell">
          <span class="fill price" style="width:{(s.inPrice / maxPrice) * 100}%"></span>
          <b>${s.inPrice.toFixed(2)}</b>
        </span>
        <span class="bar" role="cell">
          <span class="fill ttft" style="width:{(s.ttft / maxTtft) * 100}%"></span>
          <b>{s.ttft.toFixed(1)}s</b>
        </span>
      </div>
    {/each}
  </div>

  <div class="sr-out" aria-live="polite">
    <span class="o-lab">You get</span>
    <p class="o-get"><b>{winner.id}</b> — {QUANT_NOTE[winner.quant]}, ${winner.inPrice.toFixed(2)}/M,
      <b>{winner.ttft.toFixed(1)}s</b>.</p>
    <p class="o-verdict">{VERDICT[sort]}</p>
  </div>

  <p class="sr-foot">
    Latency <b>null on {SELLER_FACTS.latencyNulls}</b> endpoints, uptime on {SELLER_FACTS.uptimeAvailable} —
    so seller ranking is the gateway's.
  </p>
</div>

<style>
  .sr { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .sr-sorts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .sr-sorts button { cursor: pointer; font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); padding: 7px 12px; }
  .sr-sorts button:hover { background: rgba(28,22,17,0.06); border-color: rgba(28,22,17,0.38); }
  .sr-sorts button.on { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }

  .sr-tbl { border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); overflow: hidden; }
  .row { display: grid; grid-template-columns: minmax(150px,1.6fr) 82px 1fr 1fr; gap: 10px; align-items: center;
    padding: 7px 11px; border-bottom: 1px solid rgba(28,22,17,0.07); transition: background 0.15s; }
  .row:last-child { border-bottom: none; }
  .row.hd { background: rgba(28,22,17,0.05); }
  .row.hd span { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .row.win { background: var(--accent-ink-tint-12); }
  .nm { font-family: var(--font-body); font-size: var(--fs-label); color: var(--text-primary); min-width: 0; }
  .nm em { font-style: normal; color: var(--accent-ink); font-weight: 700; margin-right: 3px; }
  .nm i { display: block; font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.35; color: rgba(28,22,17,0.52); }
  .q { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-align: center; padding: 2px 0; border-radius: var(--radius-sharp); }
  .q[data-q='fp8'] { color: #2d7a3a; background: rgba(45,122,58,0.12); }
  .q[data-q='fp4'] { color: #b4632e; background: rgba(180,99,46,0.14); }
  .q[data-q='unknown'] { color: rgba(28,22,17,0.5); background: rgba(28,22,17,0.07); }
  .bar { position: relative; display: flex; align-items: center; height: 20px; background: rgba(28,22,17,0.05); border-radius: var(--radius-sharp); min-width: 0; }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: var(--radius-sharp); transition: width 0.3s ease; }
  .fill.price { background: rgba(180,99,46,0.32); }
  .fill.ttft { background: rgba(14,91,102,0.28); }
  .bar b { position: relative; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-primary); padding-left: 7px; }

  .sr-out { margin-top: 12px; border-left: 3px solid var(--accent); background: rgba(196,87,10,0.08);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; padding: 10px 14px; }
  .o-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .o-get { margin: 4px 0 6px; font-size: var(--fs-nav); line-height: 1.5; color: var(--text-primary); }
  .o-verdict { margin: 0; font-size: var(--fs-label); line-height: 1.58; color: rgba(28,22,17,0.76); max-width: 84ch; min-height: 3.2em; }

  .sr-foot { margin: 11px 0 0; font-size: var(--fs-label-xs); line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 92ch; }
  .sr-foot b { color: rgba(28,22,17,0.8); }

  @media (max-width: 640px) {
    .row { grid-template-columns: 1fr 60px; grid-auto-rows: min-content; gap: 5px 8px; }
    .row.hd { display: none; }
  }
</style>
