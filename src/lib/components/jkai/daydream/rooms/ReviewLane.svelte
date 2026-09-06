<script lang="ts">
  // The suggestions the engine would not act on by itself.
  //
  // Automatic grooming applies what it can prove on every load — a merge, or a
  // retirement where every word of the request is present in something already
  // live. What is left here is the residue: matches strong enough to raise and
  // too weak to act on, one per deliverable, and there were 113 of them.
  //
  // One at a time, that is 113 round trips, each of which reloads the whole
  // room. So the unit of work here is a SELECTION: tick a set of rows, rule on
  // all of them in one request, and get back what was decided and what had
  // moved underneath. `decideBacklogGroomingMany` takes the same lock the
  // automatic pass takes and tolerates the same staleness — a suggestion the
  // previous decision in the batch invalidated is reported, never forced.
  import { kindLabel } from '$lib/selfimprove/board';
  import { matchClaim, sharedTerms } from '$lib/selfimprove/backlog-board';
  import type { BacklogEpic } from '$lib/selfimprove/epic-backlog';
  import type { GroomingSuggestion } from '$lib/selfimprove/backlog-grooming';
  import type { WorkItem } from '$lib/selfimprove/board';

  interface Props {
    epics: BacklogEpic[];
    busy: string | null;
    act: (body: Record<string, unknown>, key: string) => Promise<boolean>;
    /** Open the epic a row belongs to, so a decision can be made in context. */
    onopen: (slug: string) => void;
  }

  let { epics, busy, act, onopen }: Props = $props();

  interface Row {
    suggestion: GroomingSuggestion;
    item: WorkItem;
    epic: BacklogEpic;
  }

  const rows = $derived<Row[]>(
    epics.flatMap((epic) =>
      (epic.suggestions ?? []).flatMap((suggestion) => {
        const item = epic.deliverables.find((i) => i.id === suggestion.itemId);
        return item ? [{ suggestion, item, epic }] : [];
      }),
    ),
  );

  let kind = $state<'all' | 'merge' | 'covered'>('all');
  let query = $state('');
  let picked = $state<string[]>([]);
  /** What the last batch did. A bulk decision that silently reloads the page
   *  is indistinguishable from one that did nothing. */
  let report = $state<string | null>(null);

  const shown = $derived(
    rows.filter(
      (r) =>
        (kind === 'all' || r.suggestion.kind === kind) &&
        [r.item.title, r.suggestion.targetTitle, r.epic.title]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    ),
  );
  const merges = $derived(rows.filter((r) => r.suggestion.kind === 'merge').length);
  const covered = $derived(rows.length - merges);
  /** Only what is on screen may be selected, so "select all" can never rule on
   *  rows a filter is hiding. */
  const selectable = $derived(new Set(shown.map((r) => r.suggestion.id)));
  const selected = $derived(picked.filter((id) => selectable.has(id)));
  const working = $derived(busy === 'review-bulk');

  function toggle(id: string) {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
  }
  function selectAll() {
    picked = [...selectable];
  }
  function selectNone() {
    picked = [];
  }

  async function decide(ids: string[], decision: 'apply' | 'keep', key: string) {
    if (ids.length === 0) return;
    report = null;
    const ok = await act({ action: 'backlog_grooming_decide', ids, decision }, key);
    if (ok) {
      report =
        decision === 'apply'
          ? `Applied ${ids.length} suggestion${ids.length === 1 ? '' : 's'}.`
          : `Kept ${ids.length} deliverable${ids.length === 1 ? '' : 's'} separate.`;
    }
    picked = [];
  }
</script>

{#if rows.length === 0}
  <div class="card t-good">
    <p class="card-body">
      Nothing waiting. Every arrival the matcher could rule on has been ruled on, and nothing
      is close enough to a shipped feature to be worth a second look.
    </p>
  </div>
{:else}
  <div class="rv-bar">
    <div class="seg" role="group" aria-label="Which suggestions to show">
      <button type="button" class="seg-btn" class:on={kind === 'all'} aria-pressed={kind === 'all'} onclick={() => (kind = 'all')}>
        All<span class="n">{rows.length}</span>
      </button>
      <button type="button" class="seg-btn" class:on={kind === 'merge'} aria-pressed={kind === 'merge'} onclick={() => (kind = 'merge')}>
        Merges<span class="n">{merges}</span>
      </button>
      <button type="button" class="seg-btn" class:on={kind === 'covered'} aria-pressed={kind === 'covered'} onclick={() => (kind = 'covered')}>
        Covered<span class="n">{covered}</span>
      </button>
    </div>

    <input
      class="text-input rv-search"
      type="search"
      bind:value={query}
      placeholder="search these suggestions…"
      aria-label="Search the review queue"
    />

    <span class="rv-spacer"></span>
    <button type="button" class="btn sm" disabled={shown.length === 0} onclick={selectAll}>
      Select {shown.length} shown
    </button>
    <button type="button" class="btn sm" disabled={selected.length === 0} onclick={selectNone}>Clear</button>
  </div>

  <!-- The bulk bar is the point of this section, so it is always present and
       says what it would do rather than appearing once something is ticked. -->
  <div class="rv-bulk" class:armed={selected.length > 0}>
    <span class="rv-count">
      <b>{selected.length}</b> selected of {shown.length} shown
    </span>
    <span class="rv-spacer"></span>
    <button
      type="button"
      class="cta sm"
      disabled={selected.length === 0 || working}
      title="Merges each selected deliverable's requirements into its match, or retires it where the match is already live. Nothing is deleted — a retired row is parked and keeps its history."
      onclick={() => decide(selected, 'apply', 'review-bulk')}
    >{working ? 'Working…' : `Apply ${selected.length || ''}`}</button>
    <button
      type="button"
      class="btn sm"
      disabled={selected.length === 0 || working}
      title="Pins each selected deliverable apart. Automatic grouping will not raise it again."
      onclick={() => decide(selected, 'keep', 'review-bulk')}
    >Keep separate</button>
  </div>

  {#if report}<p class="note good" role="status">{report}</p>{/if}

  <div class="tbl-wrap">
    <table class="tbl">
      <colgroup>
        <col style="width: 38px" />
        <col style="width: 92px" />
        <col style="width: 25%" />
        <col style="width: 25%" />
        <col />
        <col style="width: 154px" />
      </colgroup>
      <thead>
        <tr>
          <th><span class="sr-only">Select</span></th>
          <th>Kind</th>
          <th>This deliverable</th>
          <th>Looks like</th>
          <th>Why the matcher raised it</th>
          <th class="right">Decide</th>
        </tr>
      </thead>
      <tbody>
        {#each shown as row (row.suggestion.id)}
          {@const id = row.suggestion.id}
          {@const rowBusy = busy === `rv:${id}` || working}
          {@const terms = sharedTerms(row.item.title, row.suggestion.targetTitle)}
          <tr class:picked={picked.includes(id)}>
            <td>
              <input
                type="checkbox"
                checked={picked.includes(id)}
                aria-label="Select {row.item.title}"
                onchange={() => toggle(id)}
              />
            </td>
            <td>
              <span class="pill t-{row.suggestion.kind === 'covered' ? 'watch' : 'steady'}">
                {row.suggestion.kind === 'covered' ? 'COVERED' : 'MERGE'}
              </span>
            </td>
            <td class="cell-wrap">
              <button type="button" class="cell-title" onclick={() => onopen(row.epic.slug)}>
                {row.item.title.replace(/^Epic:\s*/i, '')}
              </button>
              <span class="mark">{kindLabel(row.item.kind)} · in {row.epic.title}</span>
            </td>
            <td class="cell-wrap target">{row.suggestion.targetTitle}</td>
            <td class="cell-wrap why">
              {matchClaim(row.suggestion.reason)}
              <!-- The words the matcher joined them on. The rest of every
                   suggestion's reason is the same sentence 113 times; this is
                   the part that differs, and it is the whole of the case. -->
              {#if terms.length}
                <span class="terms">
                  {#each terms as t (t)}
                    <span class="term">{t}</span>
                  {/each}
                </span>
              {:else}
                <span class="terms"><span class="term none">no shared words in the titles</span></span>
              {/if}
            </td>
            <td class="right"><div class="act-stack">
              <button
                type="button"
                class="cta sm"
                disabled={rowBusy}
                onclick={() => decide([id], 'apply', `rv:${id}`)}
              >{row.suggestion.kind === 'covered' ? 'Retire' : 'Merge'}</button>
              <button type="button" class="btn sm" disabled={rowBusy} onclick={() => decide([id], 'keep', `rv:${id}`)}>
                Keep
              </button>
              {#if row.suggestion.targetHref}
                <a class="btn sm" href={row.suggestion.targetHref}>Inspect →</a>
              {/if}
              </div>
            </td>
          </tr>
        {:else}
          <tr><td colspan="6"><p class="note">Nothing matches that.</p></td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <p class="note">
    A merge keeps both requirements and retires the duplicate row; a retirement parks a row
    against something already live. Neither deletes anything — a parked row still counts as
    evidence in the appetite scan, and restoring one also pins it apart so the next intake
    pass cannot fold it back in.
  </p>
{/if}

<style>
  .rv-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 12px 0;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
    margin-bottom: 12px;
  }
  .rv-spacer {
    flex: 1 1 auto;
  }
  .rv-search {
    flex: 1 1 220px;
    min-width: 170px;
    width: auto;
  }

  .seg {
    display: inline-flex;
    border: 1px solid var(--line-strong);
  }
  .seg-btn {
    background: none;
    border: 0;
    padding: 7px 13px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
  }
  .seg-btn.on {
    background: var(--accent);
    color: var(--bg);
  }
  .seg-btn + .seg-btn {
    border-left: 1px solid var(--line-strong);
  }
  .seg-btn .n {
    margin-left: 6px;
    color: var(--text-ghost);
  }
  .seg-btn.on .n {
    color: var(--bg);
  }

  .rv-bulk {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 10px 12px;
    border: 1px solid var(--line-hair);
    background: var(--bg-section);
    margin-bottom: 14px;
  }
  .rv-bulk.armed {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-04);
  }
  .rv-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .tbl {
    /* Fixed, with the colgroup above. `auto` lets the longest match reason
       push the decide column off its track and over the text beside it.
       `min-width` because fixed + a narrow viewport is the other failure:
       at 390px the six tracks squeeze to a word each and 113 rows rendered
       174,000px tall. Below the measure the wrapper scrolls sideways, which
       is what `.tbl-wrap` is for. */
    table-layout: fixed;
    min-width: 980px;
  }
  .tbl :global(td) {
    vertical-align: top;
  }
  tr.picked {
    background: var(--accent-tint-04);
  }
  .cell-title {
    display: block;
    border: 0;
    background: none;
    padding: 0;
    text-align: left;
    font-family: inherit;
    font-size: var(--fs-label);
    font-weight: 600;
    line-height: 1.35;
    color: var(--text-primary);
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .cell-title:hover {
    color: var(--accent);
  }
  .cell-title + .mark {
    display: block;
    margin-top: 4px;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .target {
    font-size: var(--fs-label);
    line-height: 1.4;
    color: var(--text-primary);
  }
  /* The matcher's reason, in body font and its own column. It is the only
     thing on the row that can justify the decision, so it is not a footnote. */
  .why {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .terms {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
  .term {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border: 1px solid var(--line-hair);
    color: var(--accent-ink);
  }
  .term.none {
    border-style: dashed;
    color: var(--text-ghost);
  }
  /* The flex lives on a DIV inside the cell, never on the `<td>` itself. */
  .act-stack {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    justify-content: flex-end;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
