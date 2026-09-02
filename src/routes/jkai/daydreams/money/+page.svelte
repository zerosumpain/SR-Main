<script lang="ts">
  // Money: only what left a receipt.
  //
  // The old tab opened on a four-tile deck and then dropped straight into a
  // forty-row table with a chip strip of merchants floating above it. The
  // deck stays — it IS the headline — but the two things you actually ask of
  // this page ("where is the money coming from" and "who is taking it") are
  // now even cells you can click, computed over the whole thirty days rather
  // than over the forty rows the table happens to show.
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import Sparkline from '$lib/components/jkai/daydream/Sparkline.svelte';
  import type { DeckTile, Facet, RollupCell } from '$lib/components/jkai/daydream/hub/types';

  let { data }: { data: PageData } = $props();

  const money = $derived(data.money);
  const rollup = $derived(data.rollup);

  function pounds(minor: number): string {
    return `£${(minor / 100).toFixed(2)}`;
  }

  function ago(v: string | Date | null): string {
    if (!v) return 'never';
    const mins = Math.round((Date.now() - new Date(v).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  // Pinned to Europe/London, the same zone the spend day grouping uses,
  // because the server runs UTC and a 00:40 BST run would otherwise be filed
  // under the previous day.
  const STAMP_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  function stamp(v: string | Date | null): string {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return STAMP_FMT.format(d).replace(/^(\w{3}),/, '$1');
  }

  // ── Arming the bank rails ────────────────────────────────────────────────
  // It was a settings key you had to write by hand, which is why it stayed off
  // for a fortnight after the job shipped. Arming also brings the next run
  // forward, so a stale token shows up now rather than at 05:00 tomorrow.
  let bankBusy = $state(false);
  let bankError = $state<string | null>(null);
  async function toggleBank() {
    bankBusy = true;
    bankError = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set_bank_enabled', enabled: !data.money?.bank.enabled }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (out.error) throw new Error(out.error);
      await invalidateAll();
    } catch (err) {
      bankError = err instanceof Error ? err.message : String(err);
    } finally {
      bankBusy = false;
    }
  }

  // ── The rollup ───────────────────────────────────────────────────────────
  type SourceId = 'bank' | 'paypal' | 'receipt';
  const SOURCE_ORDER = ['bank', 'paypal', 'receipt'] as const;
  const SOURCE_LABEL: Record<SourceId, string> = {
    bank: 'Bank rails',
    paypal: 'PayPal',
    receipt: 'Receipts',
  };

  const spend30 = $derived(money?.totalMinor30d ?? 0);
  const loadedRows = $derived(money?.rows ?? []);
  /** Every verified row in the window, not the forty the table shows. */
  const verifiedRows = $derived(rollup.totalCount || loadedRows.length);

  function share(minor: number): string {
    return spend30 > 0 ? `${Math.round((minor / spend30) * 100)}%` : '—';
  }
  function rows(n: number): string {
    return `${n} ${n === 1 ? 'row' : 'rows'}`;
  }

  const moneyTiles = $derived<DeckTile[]>([
    {
      key: 'spend',
      label: 'Last 30 days',
      value: pounds(spend30),
      tone: 'steady',
      lit: true,
      sub: `${verifiedRows} verified rows · understates cash`,
    },
    {
      key: 'offers',
      label: 'Live offers',
      value: String((money?.offers ?? []).length),
      tone: (money?.offers ?? []).length ? 'action' : 'quiet',
      sub: 'found in your email',
    },
    {
      key: 'renewals',
      label: 'Dated events, 60d',
      value: String((money?.renewals ?? []).length),
      tone: (money?.renewals ?? []).length ? 'watch' : 'quiet',
      sub: 'renewals · appointments',
    },
    {
      key: 'bank',
      label: 'Bank rails',
      value: money?.bank.enabled ? 'Armed' : 'Off',
      tone: money?.bank.enabled ? (money.bank.willSkip ? 'watch' : 'good') : 'quiet',
      sub: money?.bank.window ? `window ${money.bank.window}` : 'debits only, deduped on the id',
    },
  ]);

  // Which rail the table is showing. Client state, not a URL: it filters a
  // list that is already on the page, and a spend table is not a thing you
  // send anyone a link to.
  type SourcePick = 'all' | SourceId;
  let sourcePick = $state<SourcePick>('all');
  function pickSource(id: SourcePick) {
    sourcePick = sourcePick === id ? 'all' : id;
  }

  const sourceCells = $derived<RollupCell[]>(
    rollup.sources.length
      ? [
          {
            key: 'all',
            label: 'Every rail',
            value: pounds(spend30),
            corner: '30d',
            sub: `${rows(verifiedRows)} with an id behind them`,
            tone: 'steady',
            onclick: () => (sourcePick = 'all'),
            active: sourcePick === 'all',
          },
          ...rollup.sources.map(
            (s): RollupCell => ({
              key: s.source,
              label: SOURCE_LABEL[s.source] ?? s.source,
              value: pounds(s.minor),
              corner: share(s.minor),
              sub: s.count ? `${rows(s.count)} in 30 days` : 'nothing on this rail',
              tone: 'steady',
              onclick: () => pickSource(s.source),
              active: sourcePick === s.source,
            }),
          ),
        ]
      : [],
  );

  // The five largest merchants by 30-day total. This was a strip of chips
  // carrying a name and a figure; the count is the half that says whether
  // £180 was one delivery or thirty coffees.
  const merchantCells = $derived<RollupCell[]>(
    rollup.merchants.length
      ? rollup.merchants.map(
          (m): RollupCell => ({
            key: m.merchant,
            label: m.merchant,
            value: pounds(m.minor),
            corner: share(m.minor),
            sub: `${rows(m.count)} in 30 days`,
            tone: 'steady',
          }),
        )
      : (money?.topMerchants ?? []).map(
          (m): RollupCell => ({
            key: m.merchant,
            label: m.merchant,
            value: pounds(m.minor),
            corner: share(m.minor),
            sub: '30-day total',
            tone: 'steady',
          }),
        ),
  );

  // ── The table ────────────────────────────────────────────────────────────
  type MoneyOrder = 'newest' | 'largest';
  let moneyOrder = $state<MoneyOrder>('newest');

  const moneyOrderFacets = $derived<Facet[]>([
    { id: 'newest', label: 'Newest' },
    { id: 'largest', label: 'Largest' },
  ]);

  // Counts on every chip, including the zeroes — a filter that returns
  // nothing looks broken unless the chip already said it would. These count
  // the LOADED rows, which is what the table can show.
  const sourceFacets = $derived<Facet[]>([
    { id: 'all', label: 'All', count: loadedRows.length },
    ...SOURCE_ORDER.map(
      (s): Facet => ({
        id: s,
        label: SOURCE_LABEL[s],
        count: loadedRows.filter((r) => r.source === s).length,
      }),
    ),
  ]);

  const moneyRows = $derived.by(() => {
    const list = loadedRows.filter((r) => sourcePick === 'all' || r.source === sourcePick);
    if (moneyOrder === 'largest') return [...list].sort((a, b) => b.amountMinor - a.amountMinor);
    return [...list].sort((a, b) => b.day.localeCompare(a.day));
  });

  const bankTone = $derived(
    money?.bank.enabled ? (money.bank.willSkip ? 'watch' : 'good') : 'quiet',
  );
</script>

{#if data.loadError}
  <section class="band">
    <div class="inner">
      <div class="card t-urgent">
        <p class="card-kicker">The spend ledger could not be read</p>
        <p class="card-body">{data.loadError}</p>
      </div>
    </div>
  </section>
{/if}

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / Evidenced spend"
      title={['Only what', 'left a receipt']}
      strap="Receipts{money?.bank.enabled
        ? ' and the nightly bank pull'
        : ''}, deduped on the transaction id. It understates cash and always will — nothing here is a budget."
    />
    <StatDeck tiles={moneyTiles} min={220} />

    {#if (money?.byDay ?? []).length >= 2}
      <div class="chart">
        <Sparkline
          points={(money?.byDay ?? []).map((d) => ({ label: d.day, value: d.minor / 100 }))}
          format={(v) => `£${v.toFixed(2)}`}
          height={64}
        />
      </div>
    {/if}

    {#if sourceCells.length}
      <div class="rollup">
        <p class="field-label">Where it came from · pick one to filter the table</p>
        <RollupGrid cells={sourceCells} min={200} />
      </div>
    {/if}

    {#if merchantCells.length}
      <div class="rollup">
        <p class="field-label">Who took the most, 30 days</p>
        <RollupGrid cells={merchantCells} min={190} dense />
      </div>
    {/if}
  </div>
</section>

<section class="band sunken">
  <div class="inner">
    <SectionHead
      kicker="B / Recent"
      title={['Every verified', 'row']}
      strap="Nothing on this table was inferred; each row came from a receipt or a bank line with an id behind it."
    />
    {#if loadedRows.length === 0}
      <div class="card t-quiet">
        <p class="card-body">
          Nothing verified yet. Receipts land as they arrive by email{money?.bank.enabled
            ? ' and from the bank overnight'
            : ''}.
        </p>
      </div>
    {:else}
      <div class="controls">
        <FacetBar
          label="Order"
          active={moneyOrder}
          facets={moneyOrderFacets}
          onpick={(id) => (moneyOrder = id as MoneyOrder)}
        />
        <FacetBar
          label="Rail"
          active={sourcePick}
          facets={sourceFacets}
          onpick={(id) => (sourcePick = id as SourcePick)}
        />
      </div>
      <div class="tbl-wrap framed">
        <table class="tbl">
          <thead
            ><tr><th>Day</th><th>Merchant</th><th class="right">Amount</th><th class="right">Via</th></tr></thead
          >
          <tbody>
            {#each moneyRows as r (r.id)}
              <tr>
                <td>{r.day}</td>
                <td class="cell-lead">{r.merchant}</td>
                <td class="right num">{pounds(r.amountMinor)}</td>
                <td class="right">{r.source}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if moneyRows.length === 0}
        <p class="note">No loaded row came in on that rail. The cells above count all thirty days.</p>
      {:else if verifiedRows > loadedRows.length}
        <p class="note">
          Showing the {loadedRows.length} most recent of {verifiedRows} verified rows; the deck and cells
          above cover the whole thirty days.
        </p>
      {/if}
    {/if}
  </div>
</section>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="C / Coming up"
      title={['Dates found', 'in the post']}
      strap="Renewals and appointments pulled out of email, next 60 days. Read as a prompt, not a diary — the diary is in the Calendar room."
    />
    {#if (money?.renewals ?? []).length === 0}
      <div class="card t-quiet"><p class="card-body">No dated events found in recent email.</p></div>
    {:else}
      <div class="tbl-wrap framed">
        <table class="tbl">
          <thead><tr><th>Date</th><th>Type</th><th>What</th></tr></thead>
          <tbody>
            {#each money?.renewals ?? [] as r (r.id)}
              <tr><td class="nowrap">{r.date}</td><td>{r.type}</td><td class="cell-lead">{r.title}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>

<section class="band sunken">
  <div class="inner">
    <SectionHead
      kicker="D / Offers"
      title={['Money left', 'on the table']}
      strap="Expiring first. Extracted from email and never acted on — the engine has no permission to spend anything."
    />
    {#if (money?.offers ?? []).length === 0}
      <div class="card t-quiet"><p class="card-body">No live offers.</p></div>
    {:else}
      <div class="tbl-wrap framed">
        <table class="tbl">
          <thead
            ><tr><th>Expires</th><th>Merchant</th><th>Offer</th><th class="right">Code</th></tr></thead
          >
          <tbody>
            {#each money?.offers ?? [] as o (o.id)}
              <tr>
                <td class="nowrap">{o.expiresAt ? String(o.expiresAt).slice(0, 10) : 'no expiry'}</td>
                <td class="cell-lead">{o.merchant}</td>
                <td class="cell-wrap">{o.summary}</td>
                <td class="right">{o.code ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>

<section class="band" id="dd-bank">
  <div class="inner">
    <SectionHead
      kicker="E / Bank rails"
      title={['The nightly', 'debits pull']}
      strap="TrueLayer and PayPal, debits only, deduped on the transaction id and written into the same table the email receipt reader uses — so everything downstream reads one set of numbers."
    >
      {#snippet aside()}
        <button
          type="button"
          class={money?.bank.enabled ? 'btn danger' : 'cta'}
          disabled={bankBusy}
          onclick={toggleBank}
        >
          {bankBusy ? 'Saving…' : money?.bank.enabled ? 'Turn the rails off' : 'Arm the rails'}
        </button>
      {/snippet}
    </SectionHead>

    <!-- A job that has only ever skipped looks identical to a job that ran
         and found nothing, unless the page says when it is next due and
         whether that moment is inside its own window. daydream-bank sat in
         exactly that state for three days and the only clue was a pulse
         summary. -->
    <div class="card t-{bankTone}">
      <p class="card-kicker">{money?.bank.enabled ? 'Armed' : 'Off'}</p>
      <p class="card-body">
        {#if money?.bank.enabled}
          Pulling nightly.
          {#if money?.bank.lastRun}Last run: {money.bank.lastRun.summary}{/if}
          It fails loudly rather than quietly if the TrueLayer token has gone stale.
        {:else}
          Off. Arming it starts the nightly pull; nothing is read until you do.
        {/if}
      </p>
      <div class="card-meta">
        {#if money?.bank.window}<span class="meta-item">window {money.bank.window}</span>{/if}
        {#if money?.bank.lastRun}
          <span class="meta-item stamp">ran {ago(money.bank.lastRun.ts)}</span>
          <span class="meta-item">{money.bank.lastRun.outcome}</span>
        {/if}
        {#if money?.bank.nextRunAt}
          <span class="meta-item stamp">next {stamp(money.bank.nextRunAt)}</span>
        {/if}
        {#if money?.bank.willSkip}
          <span class="meta-item warn">that lands outside the window — it will skip</span>
        {/if}
      </div>
      {#if bankError}<p class="err">{bankError}</p>{/if}
    </div>
  </div>
</section>

<style>
  /* Room-specific only — everything else is the `.ds-vocab` vocabulary the
     layout declares. */
  .chart {
    border: 1px solid var(--card-border);
    background: var(--surface-card);
    padding: 16px;
    margin-top: 18px;
  }

  .rollup {
    margin-top: clamp(20px, 2.4vw, 32px);
  }

  /* The vocabulary's `.tbl-wrap` only scrolls; the money tables carried a
     frame of their own and keep it. */
  .framed {
    border: 1px solid var(--card-border);
    margin-top: 14px;
  }
</style>
