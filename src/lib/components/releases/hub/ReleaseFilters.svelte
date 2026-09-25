<script lang="ts">
  // The console strip. A plain GET form, so it works with JavaScript off and
  // every view it produces is a shareable URL — the same contract the rest of
  // the page keeps.
  //
  // It carries no `page` input, which is deliberate: changing a filter should
  // land you on the first page of the new result, not on page 7 of it.
  //
  // The owner gets two extra controls. Impact and source are only meaningful
  // against the unfiltered corpus — an anonymous reader is served the
  // user-facing subset already, so an "impact" select would offer one real
  // choice and one empty one.
  import { KIND_LABEL, RELEASE_ITEM_KINDS, type ReleaseItemKind } from '$lib/releases/types';
  import type { ReleaseMonth } from '$lib/releases/console';

  interface Props {
    kind: string;
    q: string;
    from: string;
    to: string;
    today: string;
    timeBuckets: ReleaseMonth[];
    /**
     * The kinds worth offering. Omit for all six — the owner sees the whole
     * corpus. The public view passes the kinds its corpus actually contains,
     * because `infra` items are removed wholesale by the public filter and an
     * option that can only ever return nothing is a dead end, not a choice.
     */
    kinds?: string[];
    /** Owner only. */
    impact?: string;
    via?: string;
    vias?: { via: string; count: number }[];
    owner?: boolean;
    /** `357 capabilities` — what the current filter actually matched. */
    result: string;
  }

  let {
    kind,
    q,
    from,
    to,
    today,
    timeBuckets,
    kinds = [...RELEASE_ITEM_KINDS],
    impact = 'all',
    via = 'all',
    vias = [],
    owner = false,
    result,
  }: Props = $props();

  const dirty = $derived(kind !== 'all' || q !== '' || impact !== 'all' || via !== 'all' || from !== '' || to !== '');
  const monthPeak = $derived(Math.max(1, ...timeBuckets.map((bucket) => bucket.deploys)));

  function daysBack(days: number): string {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days + 1);
    return date.toISOString().slice(0, 10);
  }

  function monthEnd(month: string): string {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    date.setUTCDate(0);
    return date.toISOString().slice(0, 10);
  }

  function timeHref(start: string, end: string): string {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (kind !== 'all') params.set('kind', kind);
    if (owner && impact !== 'all') params.set('impact', impact);
    if (owner && via !== 'all') params.set('via', via);
    if (start) params.set('from', start);
    if (end) params.set('to', end);
    const query = params.toString();
    return query ? `/releases?${query}` : '/releases';
  }

  function overlapsMonth(month: string): boolean {
    return Boolean(from || to) && (!from || from <= monthEnd(month)) && (!to || to >= `${month}-01`);
  }

  function monthHref(month: string): string {
    const start = `${month}-01`;
    const end = monthEnd(month);
    return from === start && to === end ? timeHref('', '') : timeHref(start, end);
  }

  function monthLabel(month: string): string {
    return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
      month: 'short', year: '2-digit', timeZone: 'UTC',
    });
  }
</script>

<form class="cf" method="get">
  <div class="cf-main">
  <label class="cf-field grow">
    <span class="cf-label">Search</span>
    <input
      id="rel-q"
      type="search"
      name="q"
      value={q}
      placeholder={owner ? 'version, sha, feature or summary text' : 'a feature, a page, a version'}
    />
  </label>

  <label class="cf-field">
    <span class="cf-label">Kind</span>
    <select id="rel-kind" name="kind" value={kind}>
      <option value="all">All kinds</option>
      {#each kinds as k (k)}
        <option value={k}>{KIND_LABEL[k as ReleaseItemKind] ?? k}</option>
      {/each}
    </select>
  </label>

  {#if owner}
    <label class="cf-field">
      <span class="cf-label">Impact</span>
      <select id="rel-impact" name="impact" value={impact}>
        <option value="all">All</option>
        <option value="user-facing">User-facing</option>
        <option value="internal">Internal</option>
      </select>
    </label>

    <label class="cf-field">
      <span class="cf-label">Source</span>
      <select id="rel-via" name="via" value={via}>
        <option value="all">All sources</option>
        {#each vias as v (v.via)}
          <option value={v.via}>{v.via} ({v.count})</option>
        {/each}
      </select>
    </label>
  {/if}

  <button class="cf-go" type="submit">Apply</button>
  {#if dirty}
    <a class="cf-clear" href="/releases">Clear</a>
  {/if}
  <span class="cf-result">{result}</span>
  </div>

  <div class="cf-time">
    <div class="cf-time-head">
      <span class="cf-label">Time · all deploys · UTC</span>
      <nav class="cf-presets" aria-label="Quick time ranges">
        <a href={timeHref('', '')} class:active={!from && !to}>All</a>
        {#each [30, 90, 365] as days (days)}
          <a href={timeHref(daysBack(days), today)} class:active={from === daysBack(days) && to === today}>
            {days === 365 ? '1 year' : `${days} days`}
          </a>
        {/each}
      </nav>
      <div class="cf-dates">
        <label>From <input type="date" name="from" value={from} max={today} /></label>
        <span aria-hidden="true">→</span>
        <label>To <input type="date" name="to" value={to} max={today} /></label>
      </div>
    </div>

    {#if timeBuckets.length}
      <nav class="cf-months" aria-label="Filter by deployment month">
        {#each timeBuckets as bucket (bucket.month)}
          <a
            href={monthHref(bucket.month)}
            class:active={overlapsMonth(bucket.month)}
            aria-label="{monthLabel(bucket.month)}: {bucket.deploys} deploys; filter to this month"
            title="{monthLabel(bucket.month)} · {bucket.deploys} deploys"
          >
            <span class="cf-month-track"><span style="height: {Math.max(2, (bucket.deploys / monthPeak) * 100)}%"></span></span>
            <span class="cf-month-label">{monthLabel(bucket.month)}</span>
          </a>
        {/each}
      </nav>
    {:else}
      <p class="cf-no-time">No deployment dates recorded.</p>
    {/if}
  </div>
</form>

<style>
  .cf {
    display: block;
    padding: 12px 0 14px;
    border-bottom: 1px solid var(--line-strong);
    margin-bottom: 16px;
  }
  .cf-main {
    display: flex;
    align-items: flex-end;
    gap: 9px;
    flex-wrap: wrap;
    padding-bottom: 12px;
  }
  .cf-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .cf-field.grow {
    flex: 1;
    min-width: 220px;
  }
  .cf-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .cf input,
  .cf select {
    font-family: var(--font-body);
    /* 16px, not a label size: under it mobile Safari force-zooms the viewport
       and strands the rest of the row off-screen. */
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 6px 8px;
    min-width: 0;
  }
  .cf input:focus-visible,
  .cf select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .cf-go {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 9px 13px;
    border: 1px solid var(--accent);
    border-radius: 0;
    background: var(--accent);
    color: var(--bg);
    cursor: pointer;
    transition:
      background 0.2s ease-out,
      color 0.2s ease-out;
  }
  .cf-go:hover {
    background: transparent;
    color: var(--accent);
  }

  .cf-clear,
  .cf-result {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding-bottom: 8px;
  }
  .cf-clear {
    color: var(--accent-ink);
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }
  .cf-clear:hover {
    border-bottom-color: var(--accent-ink);
  }
  .cf-result {
    color: var(--text-ghost);
    margin-left: auto;
  }
  .cf-time { border-top: 1px solid var(--line-hair); padding-top: 10px; }
  .cf-time-head { display: flex; align-items: center; gap: 10px 20px; flex-wrap: wrap; }
  .cf-presets { display: flex; gap: 2px; flex-wrap: wrap; }
  .cf-presets a { font: var(--fs-label-xs) var(--font-mono); color: var(--text-muted); text-decoration: none; padding: 4px 7px; border: 1px solid transparent; }
  .cf-presets a.active { color: var(--accent); border-color: var(--accent); }
  .cf-presets a:hover { color: var(--accent); }
  .cf-presets a:focus-visible, .cf-months a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cf-dates { display: flex; align-items: center; gap: 7px; margin-left: auto; color: var(--text-muted); font: var(--fs-label-xs) var(--font-mono); }
  .cf-dates label { display: flex; align-items: center; gap: 6px; }
  .cf-dates input { width: 148px; padding: 3px 5px; font-size: var(--fs-body); }
  .cf-months { display: flex; gap: 2px; overflow-x: auto; padding: 8px 0 2px; }
  .cf-months a { flex: 1 0 38px; min-width: 38px; max-width: 85px; display: flex; flex-direction: column; gap: 3px; text-align: center; text-decoration: none; color: var(--text-ghost); }
  .cf-month-track { height: 34px; display: flex; align-items: flex-end; background: var(--surface-overlay); border-bottom: 1px solid var(--line-strong); }
  .cf-month-track > span { display: block; width: 100%; min-height: 2px; background: var(--accent-ink-tint-35); }
  .cf-months a.active .cf-month-track > span { background: var(--accent); }
  .cf-months a:hover .cf-month-track > span { background: var(--accent-ink); }
  .cf-month-label { font: var(--fs-label-xs) var(--font-mono); white-space: nowrap; }
  .cf-months a.active .cf-month-label { color: var(--accent); font-weight: 700; }
  .cf-no-time { margin: 8px 0 0; color: var(--text-muted); font-size: var(--fs-label); }
  @media (max-width: 680px) {
    .cf-main { align-items: stretch; }
    .cf-main .grow { flex-basis: 100%; }
    .cf-dates { width: 100%; margin-left: 0; justify-content: space-between; }
    .cf-dates label { min-width: 0; flex: 1; }
    .cf-dates input { width: 100%; min-width: 0; }
  }
</style>
