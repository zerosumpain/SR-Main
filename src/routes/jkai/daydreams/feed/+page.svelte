<script lang="ts">
  // The feed, as a matrix.
  //
  // Families down, reader states across, a count in every cell — over the
  // whole ledger, not the last sixty rows. A cell is a link (`?f=&s=`), so the
  // selection is shareable and server-rendered. Below it, the rows behind the
  // selected cell, one line each; a line opens the drill.
  //
  // Colour is priority (`priority.ts`), category is a MARK. The row is a
  // summary: `explanation`, never `narrative` — model prose may not appear
  // without the checked/UNCHECKED tag that rides with it in the drill.
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import CategoryMatrix from '$lib/components/jkai/daydream/hub/CategoryMatrix.svelte';
  import ThoughtDrill from '$lib/components/jkai/daydream/rooms/ThoughtDrill.svelte';
  import TriageDeck from '$lib/components/jkai/daydream/rooms/TriageDeck.svelte';
  import type { Facet, MatrixAxis } from '$lib/components/jkai/daydream/hub/types';
  import { FAMILIES, FEED_STATES, familyMark, kindLabel, likelihoodBand } from '$lib/daydream/thought-groups';
  import { thoughtDestination } from '$lib/daydream/destination';
  import { bandTone, reviewTone, thoughtRank, thoughtTone } from '$lib/daydream/priority';
  import {
    RELEVANCE_TERSE,
    SHOWN_STATUSES,
    ago,
    postThought,
    reviewWord,
    stamp,
  } from '$lib/daydream/feed-client';

  let { data }: { data: PageData } = $props();
  type Thought = PageData['rows'][number];

  // ── The matrix ────────────────────────────────────────────────────────────
  const rows = $derived<MatrixAxis[]>(data.matrix.rows.map((r) => ({ id: r.id, label: r.label, mark: r.mark })));
  const cols = $derived<MatrixAxis[]>(
    data.matrix.cols.map((c) => ({
      id: c.id,
      label: c.label,
      tone: c.id === 'undecided' ? 'action' : c.id === 'held' ? 'watch' : c.id === 'sent' ? 'good' : 'quiet',
    })),
  );
  const active = $derived({ row: data.family, col: data.state ?? (data.family ? null : 'undecided') });
  function cellHref(row: string | null, col: string | null): string {
    const q = new URLSearchParams();
    if (row) q.set('f', row);
    if (col) q.set('s', col);
    const qs = q.toString();
    return `/jkai/daydreams/feed${qs ? `?${qs}` : ''}`;
  }
  const heldTotal = $derived(Object.values(data.matrix.cells).reduce((a, c) => a + (c.held ?? 0), 0));

  const cellTitle = $derived.by(() => {
    const st = FEED_STATES.find((s) => s.id === (data.state ?? (data.family ? null : 'undecided')));
    const fam = data.family ? FAMILIES[data.family] : null;
    if (fam && st) return `${st.label} · ${fam.label}`;
    if (fam) return `${fam.label} · every state`;
    if (st) return `${st.label} · every family`;
    return 'Everything';
  });

  // ── The rows ──────────────────────────────────────────────────────────────
  const thoughts = $derived(data.rows);
  /** Filed in this sitting, before the ledger reload has caught up. */
  const archivedNow = new SvelteSet<string>();
  const live = $derived(thoughts.filter((t) => !archivedNow.has(t.id)));

  type FeedOrder = 'priority' | 'newest' | 'score' | 'relevance';
  let order = $state<FeedOrder>('priority');
  const byNewest = (a: { createdAt: string }, b: { createdAt: string }) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  const ratedCount = $derived(live.filter((t) => t.relevance != null).length);
  const ordered = $derived.by(() => {
    const list = [...live];
    if (order === 'newest') return list.sort(byNewest);
    if (order === 'score') return list.sort((a, b) => b.score - a.score || byNewest(a, b));
    if (order === 'relevance') {
      // Unrated cards sort last: an absent opinion is not a middling one.
      return list.sort((a, b) => (b.relevance ?? -1) - (a.relevance ?? -1) || b.score - a.score || byNewest(a, b));
    }
    return list.sort((a, b) => thoughtRank(a) - thoughtRank(b) || b.score - a.score);
  });
  const orderFacets = $derived<Facet[]>([
    { id: 'priority', label: 'Priority' },
    { id: 'newest', label: 'Newest' },
    { id: 'score', label: 'Score' },
    { id: 'relevance', label: 'Relevance', count: ratedCount },
  ]);

  function headline(t: Thought): string {
    if (t.placeLabel) return t.placeLabel;
    if (t.placeSuggested) return `Is this ${t.placeSuggested}?`;
    if (t.placeAddress) return `The place on ${t.placeAddress}`;
    return t.title;
  }
  function answered(t: Thought): boolean {
    return Boolean(t.placeLabel) && t.kind.startsWith('unknown');
  }
  function summary(t: Thought): string {
    return answered(t) ? `You named this ${t.placeLabel}. It asked: “${t.title}”` : t.explanation;
  }
  function canRate(t: Thought): boolean {
    return !t.feedback && SHOWN_STATUSES.includes(t.status);
  }
  function learningFor(kind: string) {
    return data.detectors.find((d) => d.kind === kind) ?? null;
  }

  // ── Actions on a row ──────────────────────────────────────────────────────
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  async function act(body: Record<string, unknown>, key: string): Promise<boolean> {
    busy = key;
    actionError = null;
    const r = await postThought(body);
    if (!r.ok) actionError = r.error;
    else await invalidateAll();
    busy = null;
    return r.ok;
  }
  async function vote(t: Thought, verdict: 'useful' | 'not_useful') {
    const ok = await act({ action: 'feedback', id: t.id, verdict }, `${t.id}:${verdict}`);
    // A useful vote weaves it into the Intel graph, quietly — failure reported
    // in the drill, never thrown in the way of the vote.
    if (ok && verdict === 'useful') await postThought({ action: 'weave', id: t.id });
  }
  /** Optimistic: the row leaves at once, and comes back if the server refused. */
  async function archive(t: Thought) {
    archivedNow.add(t.id);
    if (openId === t.id) openId = null;
    const ok = await act({ action: 'archive', id: t.id }, `${t.id}:archive`);
    if (!ok) archivedNow.delete(t.id);
  }

  // ── The drill ─────────────────────────────────────────────────────────────
  let openId = $state<string | null>(null);
  const openRow = $derived(
    openId ? (thoughts.find((t) => t.id === openId) ?? (data.opened?.id === openId ? data.opened : null)) : null,
  );
  // `?open=` / `?rate=` land ON the thought. Tracked read is the URL; the
  // write is untracked, so this cannot re-trigger on the value it assigned.
  const urlOpen = $derived(page.url.searchParams.get('open') ?? page.url.searchParams.get('rate'));
  $effect(() => {
    const id = urlOpen;
    untrack(() => {
      if (id && openId !== id) openId = id;
    });
  });

  // ── Steer (kept until the notebook absorbs it) ────────────────────────────
  type Steer = { id: string; text: string; status: string; batchesInfluenced: number };
  let steers = $state<Steer[]>([]);
  let steerText = $state('');
  let steerBusy = $state(false);
  let steerError = $state<string | null>(null);
  $effect(() => {
    const incoming = data.steers;
    untrack(() => {
      steers = (incoming ?? []) as Steer[];
    });
  });
  async function steerPost(body: Record<string, unknown>) {
    steerError = null;
    const r = await postThought<{ steers?: Steer[] }>(body);
    if (!r.ok) steerError = r.error;
    else if (r.out.steers) steers = r.out.steers;
    return r.ok;
  }
  async function submitSteer() {
    const text = steerText.trim();
    if (!text) return;
    steerBusy = true;
    if (await steerPost({ action: 'add_steer', text })) steerText = '';
    steerBusy = false;
  }
</script>

{#if data.loadError}
  <section class="band">
    <div class="inner">
      <div class="card t-urgent">
        <p class="card-kicker">The feed did not load</p>
        <p class="card-body">{data.loadError}</p>
      </div>
    </div>
  </section>
{/if}

<!-- ── A / THE MATRIX ─────────────────────────────────────────────────────── -->
<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / What it has noticed"
      title={['Every family,', 'every state']}
      strap="Down: what sort of thing. Across: whether it reached you, is waiting on you, was held back, or is dealt with. A cell opens the rows behind it. Orange is waiting on your verdict; grey is finished business."
    />
    <CategoryMatrix {rows} {cols} cells={data.matrix.cells} href={cellHref} {active} corner="family" />
    <p class="note">
      {data.matrix.total} thought{data.matrix.total === 1 ? '' : 's'} on the ledger · threshold {data.threshold.value} from {data.threshold.feedbackCount} response{data.threshold.feedbackCount === 1 ? '' : 's'}
    </p>
  </div>
</section>

<!-- ── B / THE ROWS ──────────────────────────────────────────────────────── -->
<section class="band sunken" id="dd-rows">
  <div class="inner">
    <SectionHead kicker="B / {cellTitle}" title={[`${live.length} row${live.length === 1 ? '' : 's'}`]} strap={null}>
      {#snippet aside()}
        <FacetBar label="Order" active={order} facets={orderFacets} onpick={(id) => (order = id as FeedOrder)} />
      {/snippet}
    </SectionHead>

    {#if actionError}<p class="err">{actionError}</p>{/if}

    {#if ordered.length === 0}
      <div class="card t-quiet">
        <p class="card-body">
          {#if data.matrix.total === 0}
            Nothing noticed yet. The Engine room says what each detector is waiting for.
          {:else}
            Nothing in this cell. The matrix above says where everything went.
          {/if}
        </p>
      </div>
    {:else}
      <ol class="rows">
        {#each ordered as t (t.id)}
          {@const band = likelihoodBand(t.score, data.threshold.value)}
          {@const dest = thoughtDestination(t)}
          <li class="trow t-{thoughtTone(t)}" class:open={openId === t.id}>
            <span class="mark">{familyMark(t.kind)}</span>
            <div class="trow-main">
              <button type="button" class="trow-title" onclick={() => (openId = t.id)}>{headline(t)}</button>
              <p class="trow-sum">{summary(t)}</p>
            </div>
            <div class="trow-chips">
              {#if answered(t)}
                <span class="pill t-good">answered</span>
              {:else if t.reviewVerdict}
                <span class="tag t-{reviewTone(t.reviewVerdict)}" title={t.reviewReasoning ?? ''}>{reviewWord(t.reviewVerdict)}</span>
              {/if}
              <span class="tag t-{bandTone(band.id)}" title={band.meaning}>{band.label}</span>
              <span class="tag" title={kindLabel(t.kind)}>{kindLabel(t.kind)}</span>
              {#if t.feedback}<span class="tag t-good">you said {t.feedback.replace('_', ' ')}</span>{/if}
              {#if t.relevance != null}<span class="tag" title="relevance">{RELEVANCE_TERSE[t.relevance]}</span>{/if}
              {#if t.suppressedReason}<span class="tag t-watch">{t.suppressedReason.replace(/_/g, ' ').replace(/\s*\(.*\)$/, '')}</span>{/if}
              <span class="trow-when" title={stamp(t.createdAt)}>{ago(t.createdAt)}</span>
            </div>
            <div class="trow-acts">
              {#if canRate(t)}
                <button type="button" class="btn sm" disabled={busy?.startsWith(t.id)} onclick={() => vote(t, 'useful')}>Useful</button>
                <button type="button" class="btn sm" disabled={busy?.startsWith(t.id)} onclick={() => vote(t, 'not_useful')}>Not useful</button>
              {/if}
              {#if t.status !== 'archived'}
                <button type="button" class="btn sm" disabled={busy?.startsWith(t.id)} onclick={() => archive(t)} title="Seen it. File it away without saying whether it was any good.">OK</button>
              {/if}
              {#if dest}
                <a class="btn sm" href={dest.href} title={dest.hint}>{dest.label}{#if dest.external}<span class="q-ext">↗</span>{/if}</a>
              {/if}
              <button type="button" class="cta sm" onclick={() => (openId = t.id)}>Open</button>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</section>

<!-- ── C / THE SORTING DECK ──────────────────────────────────────────────── -->
{#if heldTotal}
  <section class="band" id="dd-deck">
    <div class="inner">
      <TriageDeck held={heldTotal} />
    </div>
  </section>
{/if}

<!-- ── D / STEER ─────────────────────────────────────────────────────────── -->
<section class="band sunken">
  <div class="inner">
    <SectionHead
      kicker="D / Steer it"
      title={['Point it at', 'something']}
      strap="The only owner-authored text the engine reads beyond a place name. It reorders what gets attention and grants no new access."
    />
    <div class="steer">
      <label class="field-label" for="steer-input">Ask it to look into something</label>
      <div class="actions">
        <input
          id="steer-input"
          class="text-input"
          bind:value={steerText}
          maxlength="280"
          placeholder="e.g. whether going out late costs me the next morning"
          onkeydown={(e) => { if (e.key === 'Enter') submitSteer(); }}
        />
        <button type="button" class="cta" disabled={steerBusy || !steerText.trim()} onclick={submitSteer}>
          {steerBusy ? 'Adding…' : 'Add a steer'}
        </button>
      </div>
      {#if steerError}<p class="err">{steerError}</p>{/if}
    </div>
    {#if steers.length}
      <div class="tbl-wrap">
        <table class="tbl compact">
          <thead><tr><th>Steer</th><th class="right">Influence</th><th class="right">Do</th></tr></thead>
          <tbody>
            {#each steers as st (st.id)}
              <tr class:dim={st.status !== 'active'}>
                <td class="cell-lead">{st.text}</td>
                <td class="right">{st.status === 'active' ? `${st.batchesInfluenced} batch${st.batchesInfluenced === 1 ? '' : 'es'}` : st.status}</td>
                <td class="right nowrap">
                  {#if st.status === 'active'}
                    <button type="button" class="btn sm" onclick={() => steerPost({ action: 'set_steer_status', id: st.id, status: 'done' })}>Done</button>
                    <button type="button" class="btn sm danger" onclick={() => steerPost({ action: 'set_steer_status', id: st.id, status: 'dropped' })}>Drop</button>
                  {:else}
                    <button type="button" class="btn sm" onclick={() => steerPost({ action: 'set_steer_status', id: st.id, status: 'active' })}>Reopen</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>

{#if openRow}
  <ThoughtDrill
    thought={openRow}
    threshold={data.threshold}
    learned={learningFor(openRow.kind)}
    onclose={() => (openId = null)}
    onarchive={(t) => void archive(t)}
  />
{/if}

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-strong);
  }
  .trow {
    --tone: var(--accent-ink);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'mark main acts'
      'mark chips acts';
    column-gap: 14px;
    row-gap: 6px;
    align-items: start;
    padding: 12px 0 12px 12px;
    border-bottom: 1px solid var(--line-hair);
    border-left: 3px solid var(--tone);
  }
  .trow.t-urgent {
    --tone: var(--error);
  }
  .trow.t-action {
    --tone: var(--accent);
  }
  .trow.t-watch {
    --tone: var(--warn);
  }
  .trow.t-good {
    --tone: var(--good);
  }
  .trow.t-quiet {
    --tone: var(--text-ghost);
  }
  .trow.open {
    background: var(--accent-tint-04);
  }
  .trow > .mark {
    grid-area: mark;
    padding-top: 3px;
    width: 64px;
  }
  .trow-main {
    grid-area: main;
    min-width: 0;
  }
  .trow-title {
    display: block;
    font-family: var(--font-display);
    font-size: var(--fs-body);
    line-height: 1.2;
    letter-spacing: -0.01em;
    text-align: left;
    color: var(--text-primary);
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    min-width: 0;
    text-wrap: pretty;
  }
  .trow-title:hover {
    color: var(--accent);
  }
  .trow-title:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .trow-sum {
    margin: 3px 0 0;
    font-size: var(--fs-nav);
    line-height: 1.45;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    overflow: hidden;
  }
  .trow-chips {
    grid-area: chips;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .trow-when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .trow-acts {
    grid-area: acts;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-self: center;
    max-width: 320px;
  }
  @media (max-width: 720px) {
    .trow {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas:
        'mark main'
        'mark chips'
        'mark acts';
    }
    .trow-acts {
      justify-content: flex-start;
      max-width: none;
    }
  }
  .steer {
    margin-bottom: 18px;
  }
</style>
