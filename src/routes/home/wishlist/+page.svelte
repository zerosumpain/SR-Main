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
  import type { FeedRef, Verdict, WishItem, WishOffer } from '$lib/wishlist/types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let adding = $state(false);
  let busyId = $state<string | null>(null);

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
  standfirst="Say what you want — a product link to watch for a price drop, or what it has to be (“gaming PC under £1,100, 16GB DDR5, RTX 5060 or better”). The sweep reads hotukdeals and PriceRunner and messages you when something meets it."
  {summary}
  footer={['strangeramblings.com/home/wishlist', 'hotukdeals · PriceRunner', 'The owner only, for now']}
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
  .card-actions form {
    display: inline;
  }
  .wl-chips :global(.pill) {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  /* A phone cannot hold five columns: each listing becomes a block — verdict
     and price on one line, then the listing, why, and history in full width. */
  @media (max-width: 640px) {
    .wl-offers thead {
      display: none;
    }
    .wl-offers,
    .wl-offers tbody {
      display: block;
    }
    .wl-offers tr {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.25rem 0.75rem;
      padding: 0.75rem 0;
    }
    .wl-offers td {
      display: block;
      padding: 0;
      border: 0;
      text-align: left;
      white-space: normal;
    }
    .wl-offers td:nth-child(n + 3) {
      grid-column: 1 / -1;
    }
  }
</style>
