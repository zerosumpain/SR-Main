<script lang="ts">
  // The wish list: say what you want in a sentence, and the sweep either
  // watches that product's price or hunts for listings that meet the
  // criteria. Each item shows what it understood (so a misread is visible),
  // where it is looking, and the listings worth a look — with the reason for
  // every verdict, because "why did it tell me about this" must always have
  // an answer on the page.
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import { describeConstraint, formatPence } from '$lib/wishlist/match';
  import { SCAN_CATEGORIES } from '$lib/wishlist/sources/scan';
  import type { FeedRef, Verdict, WishItem, WishOffer } from '$lib/wishlist/types';
  import type { CompareRow } from '$lib/wishlist/value';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let adding = $state(false);
  let busyId = $state<string | null>(null);
  /** Per item: the listings table, or the side-by-side spec comparison. */
  let views = $state<Record<string, 'list' | 'compare'>>({});
  let sorts = $state<Record<string, SortKey>>({});

  type SortKey = 'value' | 'price' | 'gpu';
  const SORTS: [SortKey, string][] = [['value', 'Best value'], ['price', 'Cheapest'], ['gpu', 'Fastest GPU']];
  // Unscored rows sort last whatever the key — an unknown is not a zero.
  const last = (n: number | null, dir: 1 | -1) => (n === null ? Infinity : dir * n);
  function sorted(rows: CompareRow[], key: SortKey): CompareRow[] {
    const by: Record<SortKey, (r: CompareRow) => number> = {
      value: (r) => last(r.value, -1),
      price: (r) => r.pricePence,
      gpu: (r) => last(r.gpuScore, -1),
    };
    return [...rows].sort((a, b) => by[key](a) - by[key](b) || a.pricePence - b.pricePence);
  }
  const cpuName = (c: string | null) => c?.replace(/^RYZEN /, 'Ryzen ').replace(/^ULTRA /, 'Core Ultra ') ?? null;
  /** The spec columns as one line, for a phone, where the columns are hidden. */
  const specLine = (r: CompareRow) =>
    [r.gpu, cpuName(r.cpu), r.ramGb === null ? null : `${r.ramGb}GB${r.ramType ? ' ' + r.ramType : ''}`, r.storageGb === null ? null : storage(r.storageGb)]
      .filter(Boolean)
      .join(' · ') || 'no specs stated';
  const storage = (gb: number | null) => (gb === null ? '—' : gb >= 1000 ? `${+(gb / 1000).toFixed(1)}TB` : `${gb}GB`);

  const WHEN = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });

  const live = $derived(data.items.filter((r) => r.item.status === 'watching' || r.item.status === 'paused'));
  const settled = $derived(data.items.filter((r) => r.item.status === 'bought' || r.item.status === 'dropped'));
  const matches = $derived(data.items.reduce((n, r) => n + r.offers.filter((o) => o.verdict === 'match').length, 0));

  const summary = $derived([
    { label: 'Watching', value: String(data.items.filter((r) => r.item.status === 'watching').length) },
    { label: 'Matches', value: String(matches), sub: 'listings meeting every ask' },
    { label: 'Settled', value: String(settled.length), sub: 'bought or dropped' },
  ]);

  const VERDICT: Record<Verdict, { label: string; tone: string }> = {
    match: { label: 'Match', tone: 't-good' },
    possible: { label: 'Check', tone: 't-watch' },
    near: { label: 'Near miss', tone: 't-action' },
    no: { label: 'No', tone: 't-quiet' },
  };

  function feedLabel(f: FeedRef): string {
    if (f.source === 'hukd-tag') return `hotukdeals · ${f.value}`;
    if (f.source === 'pricerunner-cl') return `PriceRunner · ${f.value.split('/')[1]?.replace(/-/g, ' ') ?? f.value}`;
    if (f.source === 'ocuk-cat') return `Overclockers · ${f.value.split('/').at(-1)?.replace(/-/g, ' ') ?? f.value}`;
    if (f.source === 'scan-cat') return `Scan · ${SCAN_CATEGORIES[f.value] ?? f.value}`;
    if (f.source === 'reddit') return `r/${f.value}`;
    return `search · “${f.value}”`;
  }

  function host(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /** "was £999.99 · low £949.99" — a chart in a table cell this narrow is all axis labels. */
  function history(o: WishOffer): string {
    if (o.history.length < 2) return 'one price so far';
    const first = o.history[0].pence;
    const low = Math.min(...o.history.map((h) => h.pence));
    const parts = [`was ${formatPence(first)}`];
    if (low < o.pricePence) parts.push(`low ${formatPence(low)}`);
    else if (low === o.pricePence && o.pricePence < first) parts.push('lowest yet');
    return parts.join(' · ');
  }

  const reasons = (o: WishOffer) => o.results.map((r) => (r.ok === false ? '✕ ' : r.ok === null ? '? ' : '') + r.reason).join(' · ');

  function itemMeta(i: WishItem): string[] {
    const parts: string[] = [i.kind === 'hunt' ? 'Hunt' : 'Price watch'];
    if (i.forPerson) parts.push(`for ${i.forPerson}`);
    if (i.deadline) parts.push(`by ${DAY.format(new Date(i.deadline))}`);
    parts.push(i.lastCheckedAt ? `checked ${WHEN.format(new Date(i.lastCheckedAt))}` : 'first check running…');
    return parts;
  }
</script>

<svelte:head><title>Wish list · Strange Ramblings</title></svelte:head>

<HomeFrame
  path="/home/wishlist"
  kicker="Home · Wish list"
  title={['Things to buy,', 'watched for you']}
  standfirst="Say what you want — a product link to watch for a price drop, or what it has to be (“gaming PC under £1,100, 16GB DDR5, RTX 5060 or better”). The sweep reads hotukdeals, PriceRunner, Overclockers, Scan and r/buildapcsalesuk and messages you when something meets it."
  {summary}
  footer={['strangeramblings.com/home/wishlist', 'hotukdeals · PriceRunner · Overclockers · Scan · Reddit', 'The owner only, for now']}
>
  <section class="band flush-top">
    <div class="inner">
      <form
        class="wl-add"
        method="POST"
        action="?/add"
        use:enhance={() => {
          adding = true;
          return async ({ update }) => {
            await update();
            adding = false;
          };
        }}
      >
        <label class="field-label" for="wl-ask">What do you want?</label>
        <textarea
          id="wl-ask"
          name="ask"
          class="text-input area"
          rows="3"
          placeholder="A gaming PC for Christmas: under £1,100, at least 16GB DDR5, RTX 5060 or better"
          value={form && 'ask' in form && typeof form.ask === 'string' ? form.ask : ''}
        ></textarea>
        <div class="wl-add-row">
          <button class="cta" type="submit" disabled={adding}>{adding ? 'Reading that…' : 'Add to the list'}</button>
          {#if form && 'error' in form && form.error}<p class="note warn">{form.error}</p>{/if}
          {#if form && 'added' in form && form.dropped?.length}
            <p class="note">Added. Left out: {form.dropped.join('; ')}.</p>
          {:else if form && 'added' in form}
            <p class="note good">Added — the first check is running now.</p>
          {/if}
        </div>
      </form>
    </div>
  </section>

  {#each [{ rows: live, kicker: 'A / Watching', title: ['On the', 'list'] }, { rows: settled, kicker: 'B / Settled', title: ['Bought or', 'dropped'] }] as group (group.kicker)}
    {#if group.rows.length}
      <section class="band" class:sunken={group.kicker.startsWith('B')}>
        <div class="inner">
          <SectionHead kicker={group.kicker} title={group.title as [string, string]} />
          <div class="stack">
            {#each group.rows as row (row.item.id)}
              {@const i = row.item}
              <article class="card" id={i.id} class:t-quiet={i.status !== 'watching'}>
                <p class="card-kicker">{itemMeta(i).join(' · ')}</p>
                <h2 class="card-title as-text">{i.title}</h2>
                <p class="card-body sm dim">“{i.ask}”</p>

                <div class="wl-chips">
                  {#if i.criteria.maxPricePence !== null}<span class="pill t-steady">≤ {formatPence(i.criteria.maxPricePence)}</span>{/if}
                  {#if i.targetPricePence !== null}<span class="pill t-steady">target {formatPence(i.targetPricePence)}</span>{/if}
                  {#each i.criteria.constraints as c, n (n)}<span class="pill t-steady">{describeConstraint(c)}</span>{/each}
                  {#each i.feeds as f (f.source + f.value)}<span class="pill t-quiet">{feedLabel(f)}</span>{/each}
                  {#each i.urls as u (u)}<a class="pill t-quiet" href={u} target="_blank" rel="noopener noreferrer">{host(u)}</a>{/each}
                </div>

                {#if i.lastError}<p class="note warn">{i.lastError}</p>{/if}

                {#if row.offers.length}
                  {@const view = views[i.id] ?? 'list'}
                  {@const sortKey = sorts[i.id] ?? 'value'}
                  {#if row.compare.some((r) => r.gpu || r.cpu)}<div class="wl-viewbar" role="group" aria-label="How to show the listings">
                    <button class="btn sm" type="button" aria-pressed={view === 'list'} onclick={() => (views[i.id] = 'list')}>Listings</button>
                    <button class="btn sm" type="button" aria-pressed={view === 'compare'} onclick={() => (views[i.id] = 'compare')}>Compare specs</button>
                    {#if view === 'compare'}
                      <span class="wl-sort">
                        <small class="dim">Sort</small>
                        {#each SORTS as [k, label] (k)}
                          <button class="btn sm" type="button" aria-pressed={sortKey === k} onclick={() => (sorts[i.id] = k)}>{label}</button>
                        {/each}
                      </span>
                    {/if}
                  </div>{/if}
                  {#if view === 'compare' && row.compare.some((r) => r.gpu || r.cpu)}
                    <div class="tbl-wrap">
                      <table class="tbl compact wl-compare">
                        <thead>
                          <tr><th>Value</th><th class="right">Price</th><th>Listing</th><th class="wl-spec">GPU</th><th class="wl-spec">CPU</th><th class="right wl-spec">RAM</th><th class="right wl-spec">Storage</th></tr>
                        </thead>
                        <tbody>
                          {#each sorted(row.compare, sortKey) as r (r.key)}
                            <tr>
                              <td class="nowrap">
                                {#if r.value !== null}
                                  <span class="num">{r.value}</span>
                                  <span class="wl-meter" aria-hidden="true"><span style:width="{r.value}%"></span></span>
                                  {#if r.coverage < 1}<br /><small class="dim" title="Scored on the parts the listing states">on {Math.round(r.coverage * 100)}% of specs</small>{/if}
                                {:else}
                                  <small class="dim">no GPU stated</small>
                                {/if}
                              </td>
                              <td class="right num nowrap">{r.priceLabel}</td>
                              <td class="cell-wrap">
                                <a class="link" href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
                                <br /><small class="dim">{r.merchant ? `${r.merchant} · ` : ''}{host(r.url)} · <span class="pill {VERDICT[r.verdict].tone}">{VERDICT[r.verdict].label}</span></small>
                                <br /><small class="wl-specline">{specLine(r)}</small>
                              </td>
                              <td class="nowrap wl-spec">{r.gpu ?? '—'}{#if r.gpuScore !== null}<br /><small class="dim">score {r.gpuScore}</small>{/if}</td>
                              <td class="nowrap wl-spec">{cpuName(r.cpu) ?? '—'}{#if r.cpuScore !== null}<br /><small class="dim">score {r.cpuScore}</small>{/if}</td>
                              <td class="right nowrap wl-spec">{r.ramGb === null ? '—' : `${r.ramGb}GB`}{#if r.ramType}<br /><small class="dim">{r.ramType}</small>{/if}</td>
                              <td class="right nowrap wl-spec">{storage(r.storageGb)}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                    <p class="card-body sm dim">
                      Value is performance per pound, best here = 100. Performance weighs the GPU 55%, CPU 20%, RAM 15% and storage 10%,
                      each against an RTX 5060 / Ryzen 5 7600 / 16GB / 1TB build. A part a listing does not state counts as a modest one, so hiding a spec never helps.
                    </p>
                  {:else}
                    <div class="tbl-wrap">
                      <table class="tbl compact wl-offers">
                        <thead><tr><th>Verdict</th><th class="right">Price</th><th>Listing</th><th>Why</th><th>History</th></tr></thead>
                        <tbody>
                          {#each row.offers as o (o.key)}
                            <tr>
                              <td class="nowrap"><span class="pill {VERDICT[o.verdict].tone}">{VERDICT[o.verdict].label}</span></td>
                              <td class="right num nowrap">
                                {formatPence(o.pricePence)}
                                {#if o.inStock === false}<br /><small class="dim">out of stock</small>{/if}
                              </td>
                              <td class="cell-wrap">
                                <a class="link" href={o.url} target="_blank" rel="noopener noreferrer">{o.title}</a>
                                <br /><small class="dim">{o.merchant ? `${o.merchant} · ` : ''}{host(o.url)} · seen {WHEN.format(new Date(o.lastSeenAt))}</small>
                                {#if o.sellers && o.sellers.length > 1}
                                  <br /><small class="dim">{o.sellers.slice(0, 4).map((s) => `${s.merchant} ${formatPence(s.pricePence)}`).join(' · ')}</small>
                                {/if}
                              </td>
                              <td class="cell-wrap"><small>{reasons(o)}</small></td>
                              <td class="nowrap"><small class="dim">{history(o)}</small></td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                {:else if i.lastCheckedAt}
                  <p class="card-body sm dim">Nothing worth a look yet{row.hidden ? ` — ${row.hidden} seen that do not fit` : ''}.</p>
                {/if}
                {#if row.offers.length && row.hidden}<p class="card-body sm dim">{row.hidden} more seen that do not fit.</p>{/if}

                <div class="card-actions">
                  {#if i.status === 'watching'}
                    <form method="POST" action="?/check" use:enhance={() => { busyId = i.id; return async ({ update }) => { await update(); busyId = null; }; }}>
                      <input type="hidden" name="id" value={i.id} />
                      <button class="btn sm" type="submit" disabled={busyId === i.id}>{busyId === i.id ? 'Checking…' : 'Check now'}</button>
                    </form>
                  {/if}
                  <form method="POST" action="?/reread" use:enhance={() => { busyId = i.id; return async ({ update }) => { await update(); busyId = null; }; }}>
                    <input type="hidden" name="id" value={i.id} />
                    <button class="btn sm" type="submit" disabled={busyId === i.id} title="Read the ask again — picks up sources added since">Re-read</button>
                  </form>
                  {#each (i.status === 'watching' ? [['paused', 'Pause'], ['bought', 'Bought it'], ['dropped', 'Drop']] : [['watching', 'Watch again']]) as [status, label] (status)}
                    <form method="POST" action="?/status" use:enhance>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="status" value={status} />
                      <button class="btn sm" type="submit">{label}</button>
                    </form>
                  {/each}
                  <form method="POST" action="?/remove" use:enhance>
                    <input type="hidden" name="id" value={i.id} />
                    <button class="btn sm danger" type="submit">Delete</button>
                  </form>
                  {#if row.nextCheckAt && i.status === 'watching'}<small class="dim">next check {WHEN.format(new Date(row.nextCheckAt))}</small>{/if}
                </div>
              </article>
            {/each}
          </div>
        </div>
      </section>
    {/if}
  {/each}

  {#if data.items.length === 0}
    <section class="band">
      <div class="inner">
        <div class="card t-quiet"><p class="card-body">Nothing on the list yet. Add something above.</p></div>
      </div>
    </section>
  {/if}
</HomeFrame>

<style>
  .wl-add {
    display: grid;
    gap: 0.5rem;
    max-width: 52rem;
  }
  .wl-add-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  .wl-add-row :global(.note) {
    margin: 0;
  }
  .wl-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin: 0.5rem 0 0.75rem;
  }
  .wl-viewbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.5rem;
  }
  .wl-sort {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-left: auto;
  }
  .wl-viewbar :global(.btn[aria-pressed='true']) {
    background: var(--text-primary);
    color: var(--bg);
  }
  .wl-specline {
    display: none;
  }
  .wl-meter {
    display: inline-block;
    width: 3.5rem;
    height: 6px;
    margin-left: 0.375rem;
    vertical-align: middle;
    background: var(--line-strong);
    border-radius: 2px;
  }
  .wl-meter span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
  }
  .card-actions form {
    display: inline;
  }
  .wl-chips :global(.pill) {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  /* A phone cannot hold five columns: each listing becomes a block — verdict
     and price on one line, then the listing, why, and history in full width.
     The comparison stacks the same way, value and price first, its spec
     columns folded into one line under the listing (`.wl-specline`). */
  @media (max-width: 640px) {
    .wl-compare .wl-spec {
      display: none;
    }
    .wl-specline {
      display: inline;
    }
    .wl-offers thead,
    .wl-compare thead {
      display: none;
    }
    .wl-offers,
    .wl-offers tbody,
    .wl-compare,
    .wl-compare tbody {
      display: block;
    }
    .wl-offers tr,
    .wl-compare tr {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.25rem 0.75rem;
      padding: 0.75rem 0;
    }
    .wl-offers td,
    .wl-compare td {
      display: block;
      padding: 0;
      border: 0;
      text-align: left;
      white-space: normal;
    }
    .wl-offers td:nth-child(n + 3),
    .wl-compare td:nth-child(3) {
      grid-column: 1 / -1;
    }
  }
</style>
