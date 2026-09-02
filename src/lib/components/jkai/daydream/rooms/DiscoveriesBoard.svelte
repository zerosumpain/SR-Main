<script lang="ts">
  // The propositions board: every question the engine chose to ask, and what
  // the data said back.
  //
  // Everything is shown — supported, refuted, backwards, thin and untested
  // alike. A board of only its hits looks clever and cannot be argued with,
  // which is why the filter chips carry counts including the zeroes: a facet
  // that returns nothing looks broken unless the chip already said it would.
  //
  // The rows arrive with the page now (the room's `+page.server.ts` calls the
  // same `loadBoard` the `hypothesis_board` action calls), so there is nothing
  // to open and nothing to wait for. The DAYS behind a verdict are still
  // fetched on expand: up to 120 paired rows per question, and most questions
  // are never opened.
  import { invalidateAll } from '$app/navigation';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import type { Facet } from '$lib/components/jkai/daydream/hub/types';
  import { TONE_RANK, verdictTone } from '$lib/daydream/priority';
  import { postThought, stamp } from '$lib/daydream/feed-client';
  import { FAMILY_SUBJECTS } from '$lib/daydream/types';
  import { cap, verdictLabel, type BoardOrder, type BoardRow, type HypDetail } from './discoveries';

  interface Props {
    board: BoardRow[];
    /** Whose questions. Lifted to the page so the rollup can set it. */
    who: string;
    onwho: (id: string) => void;
    /** How it came out. `unanswered` is a value, not a missing one. */
    verdict: string;
    onverdict: (id: string) => void;
    order: BoardOrder;
    onorder: (id: BoardOrder) => void;
  }

  let { board, who, onwho, verdict, onverdict, order, onorder }: Props = $props();

  // ── Whose ────────────────────────────────────────────────────────────────
  // Only people who actually have questions, in household order, so the filter
  // never offers a name with nothing behind it. The order comes from
  // `FAMILY_SUBJECTS` rather than from a family load: this room has no reason
  // to run the family query, and the constant is the same list it orders by.
  const HOUSEHOLD = FAMILY_SUBJECTS.map((f) => f.subject);

  const people = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const q of board) counts.set(q.subject, (counts.get(q.subject) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => {
        const ia = HOUSEHOLD.indexOf(a[0]);
        const ib = HOUSEHOLD.indexOf(b[0]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map(([subject, n]) => ({ subject, n }));
  });

  const whoFacets = $derived.by((): Facet[] => {
    const rows: Facet[] = [
      { id: 'all', label: 'Everyone', count: board.length },
      ...people.map((p) => ({ id: p.subject, label: cap(p.subject), count: p.n })),
    ];
    // A `?who=` deep link from the family room can name someone with nothing
    // on the board. The chip is rendered at zero rather than omitted, because
    // a filter that is on with no chip to show for it looks like an empty
    // board rather than an empty person.
    if (who !== 'all' && !rows.some((r) => r.id === who)) {
      rows.push({ id: who, label: cap(who), count: 0 });
    }
    return rows;
  });

  const verdictFacets = $derived.by((): Facet[] => {
    const scope = board.filter((q) => who === 'all' || q.subject === who);
    const n = (pred: (q: BoardRow) => boolean) => scope.filter(pred).length;
    return [
      { id: 'all', label: 'All', count: scope.length },
      { id: 'supported', label: 'Held up', count: n((q) => q.verdict === 'supported') },
      { id: 'refuted', label: 'Nothing there', count: n((q) => q.verdict === 'refuted') },
      { id: 'wrong_direction', label: 'Backwards', count: n((q) => q.verdict === 'wrong_direction') },
      { id: 'underpowered', label: 'Thin data', count: n((q) => q.verdict === 'underpowered') },
      { id: 'unanswered', label: 'Unanswered', count: n((q) => q.verdict == null) },
    ];
  });

  const orderFacets: Facet[] = [
    { id: 'priority', label: 'Priority' },
    { id: 'newest', label: 'Newest' },
    { id: 'strength', label: 'Strength' },
  ];

  const filtered = $derived(
    board.filter(
      (q) =>
        (who === 'all' || q.subject === who) &&
        (verdict === 'all' ||
          (verdict === 'unanswered' ? q.verdict == null : q.verdict === verdict)),
    ),
  );

  const visible = $derived.by(() => {
    const rows = [...filtered];
    if (order === 'newest') {
      return rows.sort((a, b) => new Date(b.proposedAt).getTime() - new Date(a.proposedAt).getTime());
    }
    if (order === 'strength') {
      return rows.sort((a, b) => Math.abs(b.r ?? 0) - Math.abs(a.r ?? 0));
    }
    return rows.sort(
      (a, b) =>
        TONE_RANK[verdictTone(a.verdict)] - TONE_RANK[verdictTone(b.verdict)] ||
        Math.abs(b.r ?? 0) - Math.abs(a.r ?? 0),
    );
  });

  // ── Rating the QUESTION, not the statistics ──────────────────────────────
  // He cannot overrule a q-value and should not be asked to; the signal is
  // whether asking was worth it. The row is reloaded rather than patched in
  // place, so what the card shows is what the ledger holds.
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  async function rateQ(row: BoardRow, feedback: 'useful' | 'not_useful') {
    busy = `q:${row.id}`;
    actionError = null;
    const { ok, error } = await postThought({ action: 'rate_question', id: row.id, verdict: feedback });
    if (ok) await invalidateAll();
    else actionError = error ?? 'that did not work';
    busy = null;
  }

  // ── From a verdict to the days behind it ─────────────────────────────────
  // A verdict you cannot open is one you have to take on trust.
  let hypOpen = $state<string | null>(null);
  let hypDetail = $state<Record<string, HypDetail>>({});
  let hypDetailError = $state<Record<string, string>>({});

  async function toggleHypDetail(id: string) {
    if (hypOpen === id) {
      hypOpen = null;
      return;
    }
    hypOpen = id;
    if (hypDetail[id]) return;
    const { ok, out, error } = await postThought<{ detail?: HypDetail }>({
      action: 'hypothesis_detail',
      id,
    });
    if (!ok) {
      hypDetailError = { ...hypDetailError, [id]: error ?? 'that did not work' };
      return;
    }
    if (out.detail) hypDetail = { ...hypDetail, [id]: out.detail };
  }
</script>

{#if board.length === 0}
  <p class="lede">Nothing asked yet. The first batch arrives on the next nightly cycle.</p>
{:else}
  <div class="controls">
    {#if people.length > 1 || who !== 'all'}
      <FacetBar label="Whose" active={who} facets={whoFacets} onpick={onwho} />
    {/if}
    <FacetBar label="Verdict" active={verdict} facets={verdictFacets} onpick={onverdict} />
    <FacetBar label="Order" active={order} facets={orderFacets} onpick={(id) => onorder(id as BoardOrder)} />
  </div>

  {#if actionError}<p class="err">{actionError}</p>{/if}

  {#if visible.length === 0}
    <div class="card t-quiet">
      <p class="card-body">No question matches that combination. The counts on the chips say where they all went.</p>
    </div>
  {/if}

  <div class="stack">
    {#each visible as q (q.id)}
      <div class="card t-{verdictTone(q.verdict)}">
        <div class="card-hd">
          <p class="card-title as-text">{q.question}</p>
          <span class="pill t-{verdictTone(q.verdict)}">{verdictLabel(q.verdict)}</span>
        </div>
        <p class="card-kicker">{cap(q.subject)}</p>

        {#if q.summary}<p class="card-body lead">{q.summary}</p>{/if}
        <p class="card-body">{q.rationale}</p>

        <div class="card-meta">
          <span class="tag">{q.metricA}{q.lagDays ? ' → ' : ' ~ '}{q.metricB}</span>
          {#if q.lagDays}<span class="meta-item">next day</span>{/if}
          <span class="meta-item">expected {q.direction}</span>
          {#if q.retestCount > 0}<span class="meta-item">retested {q.retestCount}×</span>{/if}
          <!-- Rounded. The stored values are raw doubles and the card was
               rendering `r -0.11998358323004636`, which reads as precision the
               measurement does not have. -->
          {#if q.r != null}<span class="meta-item">r {q.r.toFixed(2)}</span>{/if}
          {#if q.qValue != null}<span class="meta-item">q {q.qValue.toFixed(3)}</span>{/if}
          {#if q.pairs != null}<span class="meta-item">n {q.pairs}</span>{/if}
          {#if q.testedAt}<span class="meta-item stamp">tested {stamp(q.testedAt)}</span>{/if}
          <!-- Nothing is filtered by verdict when choosing what to retest, so
               every answer here is provisional. -->
          {#if q.retestInDays !== null}
            <span class="meta-item">
              {q.retestInDays === 0 ? 'due to be checked again' : `checked again in ${q.retestInDays}d`}
            </span>
          {/if}
          <!-- The family size is shown because a q-value cannot be read without
               it: q over 4 tests and q over 400 are not the same number. -->
          {#if q.familySize}
            <span class="meta-item">corrected across {q.familySize} test{q.familySize === 1 ? '' : 's'}</span>
          {/if}
        </div>

        <div class="card-actions bar">
          {#if q.feedback}
            <span class="meta-item good">you said {q.feedback.replace('_', ' ')}</span>
          {:else}
            <span class="ask">Worth asking?</span>
            <button type="button" class="cta" disabled={busy === `q:${q.id}`} onclick={() => rateQ(q, 'useful')}>Yes</button>
            <button type="button" class="btn" disabled={busy === `q:${q.id}`} onclick={() => rateQ(q, 'not_useful')}>No</button>
          {/if}
          <button type="button" class="btn" onclick={() => toggleHypDetail(q.id)}>
            {hypOpen === q.id ? 'Hide the days' : 'Show the days behind this'}
          </button>
        </div>

        {#if hypOpen === q.id}
          {@const d = hypDetail[q.id]}
          <div class="detail">
            {#if hypDetailError[q.id]}
              <p class="err">{hypDetailError[q.id]}</p>
            {:else if !d}
              <p class="detail-line">Reading the days…</p>
            {:else}
              <p class="detail-line">
                {d.days.length} day{d.days.length === 1 ? '' : 's'} in the window,
                <b>{d.days.length - d.unusedCount}</b> with both readings present — that count is
                the n above. Pairwise deletion, never imputation: a day missing either half is
                dropped rather than filled in.
                {#if d.lagDays}<br />Lagged: {d.metricA} on a day is paired with {d.metricB} on the next.{/if}
              </p>
              <div class="tbl-wrap framed">
                <table class="tbl compact">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th class="right">{d.metricA}</th>
                      <th class="right">{d.metricB}{d.lagDays ? ' (next day)' : ''}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each d.days.filter((x) => x.used).slice(-40).reverse() as row (row.day)}
                      <tr>
                        <td>{row.day}</td>
                        <td class="right">{row.a}</td>
                        <td class="right">{row.b}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              {#if d.days.length - d.unusedCount > 40}
                <p class="note">Most recent 40 of {d.days.length - d.unusedCount} shown.</p>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  /* Room-specific only. Everything else — .card, .pill, .tag, .tbl, .detail —
     is the layout's shared vocabulary. */
  .card-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  /* The rating bar: a rule above it, because it is a different act from
     reading the card. */
  .card-actions.bar {
    padding-top: 14px;
    border-top: 1px solid var(--line-hair);
  }
  .ask {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-right: 4px;
  }

  /* The vocabulary's `.tbl-wrap` is the scroll box; the frame is this room's. */
  .tbl-wrap.framed {
    border: 1px solid var(--card-border);
    margin-top: 14px;
  }
</style>
