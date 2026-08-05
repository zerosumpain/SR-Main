<script lang="ts">
  // SellerRoulette — the central point of the Models section: naming a model does not
  // determine what you receive. Choose a sort and watch which seller you land on, and what
  // that costs you in precision and in wait.
  import { SELLERS, SELLER_FACTS, type Seller } from '../../lib/models';

  type SortKey = 'price' | 'latency' | 'precision';
  let sort = $state<SortKey>('price');

  const SORTS: Array<{ k: SortKey; label: string; sub: string }> = [
    { k: 'price', label: 'Cheapest per token', sub: 'the obvious default' },
    { k: 'latency', label: 'Lowest latency', sub: 'sort by observed speed' },
    { k: 'precision', label: 'Full precision first', sub: 'then cheapest among those' },
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

  const VERDICT: Record<SortKey, string> = {
    price: 'You have selected a heavily quantised copy behind the longest queue. It is genuinely the cheapest per token, and on a long turn the extra fifty seconds of waiting costs more in your own time than the saving is worth. Worse: the quality score that chose this model in the first place was measured at full precision — so the auction optimised against a thing you are not receiving.',
    latency: 'Thirty-five times faster to first token than the cheapest option, for roughly three times the token price. On a tool-heavy turn with five round trips, this is the difference between a minute and eight seconds. This is the sort the system now uses.',
    precision: 'You are getting the model the benchmark actually measured. It costs about three times the floor price and is, as it happens, also near the fastest — the cheap option was not buying you speed, it was costing you speed.',
  };

  const QUANT_NOTE: Record<Seller['quant'], string> = {
    fp8: 'full precision',
    fp4: 'quantised to a quarter',
    unknown: 'precision not advertised',
  };
</script>

<div class="sr">
  <div class="sr-head">
    <div class="sr-lede">
      <span class="k">One model id · {SELLER_FACTS.endpointsAgentic} sellers</span>
      <p>The gateway load-balances every model across everyone selling it. Same name, same weights on paper —
        different precision, different price, wildly different speed. Choose how to pick one.</p>
    </div>
    <div class="sr-sorts" role="group" aria-label="Selection strategy">
      {#each SORTS as s}
        <button class:on={sort === s.k} onclick={() => (sort = s.k)}>
          <b>{s.label}</b><span>{s.sub}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="sr-tbl" role="table" aria-label="Sellers of one model, ordered by the selected strategy">
    <div class="row hd" role="row">
      <span role="columnheader">Seller</span>
      <span role="columnheader">Precision</span>
      <span role="columnheader">Input $/M</span>
      <span role="columnheader">First token</span>
    </div>
    {#each ordered as s (s.id)}
      <div class="row" class:win={s.id === winner.id} role="row">
        <span class="nm" role="cell">
          {#if s.id === winner.id}<em>▸</em>{/if}{s.id}
          {#if s.note}<i>{s.note}</i>{/if}
        </span>
        <span class="q" role="cell" data-q={s.quant}>{s.quant}</span>
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

  <div class="sr-out">
    <span class="o-lab">You get</span>
    <p class="o-get"><b>{winner.id}</b> — {QUANT_NOTE[winner.quant]}, ${winner.inPrice.toFixed(2)} per million input tokens,
      first token after <b>{winner.ttft.toFixed(1)} seconds</b>.</p>
    <p class="o-verdict">{VERDICT[sort]}</p>
  </div>

  <p class="sr-foot">
    The system cannot rank sellers on speed by itself: per-endpoint latency and throughput came back
    <b>null on {SELLER_FACTS.latencyNulls}</b> endpoints checked (uptime was present on {SELLER_FACTS.uptimeAvailable}).
    Ranking is therefore delegated to the gateway's own sort parameter — which means the speed axis in the local
    scoring model currently sits at a neutral value and does nothing. That is written down rather than quietly assumed.
  </p>
</div>

<style>
  .sr { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .sr-head { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; margin-bottom: 12px; }
  .sr-lede { flex: 1 1 300px; min-width: 0; }
  .sr-lede .k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.13em; text-transform: uppercase; color: var(--accent-ink); }
  .sr-lede p { margin: 5px 0 0; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 56ch; }
  .sr-sorts { display: flex; gap: 6px; flex-wrap: wrap; }
  .sr-sorts button { display: flex; flex-direction: column; gap: 1px; text-align: left; cursor: pointer;
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); padding: 7px 12px; }
  .sr-sorts b { font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
  .sr-sorts span { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.55); }
  .sr-sorts button:hover { background: rgba(28,22,17,0.06); border-color: rgba(28,22,17,0.38); }
  .sr-sorts button.on { background: var(--accent-ink); border-color: var(--accent-ink); }
  .sr-sorts button.on b, .sr-sorts button.on span { color: #fff; }

  .sr-tbl { border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-round); overflow: hidden; }
  .row { display: grid; grid-template-columns: minmax(150px,1.6fr) 82px 1fr 1fr; gap: 10px; align-items: center;
    padding: 7px 11px; border-bottom: 1px solid rgba(28,22,17,0.07); transition: background 0.15s; }
  .row:last-child { border-bottom: none; }
  .row.hd { background: rgba(28,22,17,0.05); }
  .row.hd span { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .row.win { background: var(--accent-ink-tint-12); }
  .nm { font-family: 'DM Sans', sans-serif; font-size: 12.5px; color: var(--text-primary); min-width: 0; }
  .nm em { font-style: normal; color: var(--accent-ink); font-weight: 700; margin-right: 3px; }
  .nm i { display: block; font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; line-height: 1.35; color: rgba(28,22,17,0.52); }
  .q { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-align: center; padding: 2px 0; border-radius: var(--radius-sharp); }
  .q[data-q='fp8'] { color: #2d7a3a; background: rgba(45,122,58,0.12); }
  .q[data-q='fp4'] { color: #b4632e; background: rgba(180,99,46,0.14); }
  .q[data-q='unknown'] { color: rgba(28,22,17,0.5); background: rgba(28,22,17,0.07); }
  .bar { position: relative; display: flex; align-items: center; height: 20px; background: rgba(28,22,17,0.05); border-radius: var(--radius-sharp); min-width: 0; }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: var(--radius-sharp); transition: width 0.3s ease; }
  .fill.price { background: rgba(180,99,46,0.32); }
  .fill.ttft { background: rgba(14,91,102,0.28); }
  .bar b { position: relative; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-primary); padding-left: 7px; }

  .sr-out { margin-top: 12px; border-left: 3px solid var(--accent); background: rgba(196,87,10,0.08);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; padding: 10px 14px; }
  .o-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .o-get { margin: 4px 0 6px; font-size: 14px; line-height: 1.5; color: var(--text-primary); }
  .o-verdict { margin: 0; font-size: 13px; line-height: 1.58; color: rgba(28,22,17,0.76); max-width: 84ch; }

  .sr-foot { margin: 11px 0 0; font-size: 11.5px; line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 92ch; }
  .sr-foot b { color: rgba(28,22,17,0.8); }

  @media (max-width: 640px) {
    .row { grid-template-columns: 1fr 60px; grid-auto-rows: min-content; gap: 5px 8px; }
    .row.hd { display: none; }
  }
</style>
