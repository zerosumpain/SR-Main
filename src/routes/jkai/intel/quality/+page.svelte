<script lang="ts">
  import MentionReview from '$lib/components/intel/MentionReview.svelte';
  // Source-data quality — the page that fixes the graph rather than reading it.
  //
  // Three problems, in the order they matter:
  //   1. Duplicate entities. The graph splits one thing across two nodes, which
  //      corrupts every degree, path and centrality figure downstream.
  //   2. A fragmented taxonomy. Types with one or two members make type filters
  //      useless and act as magnets for anything the extractor was unsure about.
  //   3. Structural health — how much of the graph actually joins up.

  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import type { DuplicateRow } from '$lib/components/intel/types';
  import { onMount } from 'svelte';

  let duplicates = $state<DuplicateRow[]>([]);
  let total = $state(0);
  let autoMergeable = $state(0);
  let threshold = $state(0.85);
  let loading = $state(true);
  let busy = $state<string | null>(null);
  let sweeping = $state(false);
  let message = $state<string | null>(null);
  let minConfidence = $state(0.5);
  /** Rows resolved this session, so they disappear without a full refetch. */
  let done = $state<Set<string>>(new Set());

  /**
   * What the sweep DID, as opposed to what it is showing.
   *
   * `ruledOut` is the count of pairs a person has already answered — a number
   * that could not exist before, because a rejection lived in a browser tab and
   * died with it. It is on screen for the same reason the source filter's
   * honesty counters are: a filter that swallows its own decisions silently is
   * indistinguishable from one that is broken.
   */
  let ruledOut = $state(0);
  let adjudicatedApart = $state(0);
  let semanticPairs = $state(0);
  let seriesVariants = $state(0);
  let undecidedInBand = $state(0);
  /** Pairs the reader has confirmed are one thing. Counted BEFORE the filter. */
  let confirmedSame = $state(0);
  let bandFloor = $state(0.4);
  /** Showing the pairs already answered, rather than the open queue. */
  let showRuledOut = $state(false);
  let adjudicating = $state(false);

  const key = (d: DuplicateRow) => `${d.keep.id}|${d.merge.id}`;
  const visible = $derived(duplicates.filter((d) => !done.has(key(d))));

  async function load() {
    loading = true;
    try {
      const params = new URLSearchParams({ min: String(minConfidence) });
      if (showRuledOut) params.set('ruledOut', '1');
      const dupRes = await fetch(`/api/jkai/intel/duplicates?${params}`);
      if (dupRes.ok) {
        const body = await dupRes.json();
        duplicates = body.duplicates ?? [];
        total = body.total ?? 0;
        autoMergeable = body.autoMergeable ?? 0;
        threshold = body.threshold ?? 0.85;
        ruledOut = body.ruledOut ?? 0;
        adjudicatedApart = body.adjudicatedApart ?? 0;
        semanticPairs = body.semanticPairs ?? 0;
        seriesVariants = body.seriesVariants ?? 0;
        undecidedInBand = body.undecidedInBand ?? 0;
        confirmedSame = body.confirmedSame ?? 0;
        bandFloor = body.bandFloor ?? 0.4;
      }
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function notify(text: string) {
    message = text;
    setTimeout(() => (message = null), 4000);
  }

  async function merge(d: DuplicateRow, swap = false) {
    const k = key(d);
    if (busy) return;
    busy = k;
    try {
      const res = await fetch('/api/jkai/intel/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'merge',
          keepId: swap ? d.merge.id : d.keep.id,
          mergeId: swap ? d.keep.id : d.merge.id,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      done = new Set([...done, k]);
      notify(`Merged into "${swap ? d.merge.name : d.keep.name}"`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      busy = null;
    }
  }

  /**
   * "These are two different things" — and it STAYS said.
   *
   * This used to add the pair to a `Set` that died with the tab, so every
   * rejection this graph ever received was thrown away and re-proposed on the
   * next nightly sweep. On a mailbox-fed graph that is most of what the queue
   * contains.
   */
  async function dismiss(d: DuplicateRow) {
    done = new Set([...done, key(d)]);
    try {
      const res = await fetch('/api/jkai/intel/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'not-duplicate',
          aId: d.keep.id,
          bId: d.merge.id,
          aName: d.keep.name,
          bName: d.merge.name,
          confidence: d.confidence,
          signals: d.signals,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      ruledOut += 1;
    } catch {
      notify('Hidden for now, but the decision did not save');
    }
  }

  /** Put an answered pair back in the queue. */
  async function undecide(d: DuplicateRow) {
    try {
      const res = await fetch('/api/jkai/intel/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'undecide', aId: d.keep.id, bId: d.merge.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      notify('Back in the queue');
      await load();
    } catch {
      notify('Could not reopen that pair');
    }
  }

  /**
   * Hand the undecided middle to a reader.
   *
   * Never merges anything. It records a verdict per pair, which moves the
   * pair's score — an agreement can carry one over the existing auto-merge
   * line, a disagreement drops it below the floor — and the threshold, its
   * chain guard and its blast-radius cap are all untouched.
   */
  async function adjudicate() {
    if (adjudicating) return;
    adjudicating = true;
    try {
      const res = await fetch('/api/jkai/intel/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'adjudicate' }),
      });
      if (!res.ok) throw new Error(await res.text());
      const r = (await res.json()).result as {
        decided: number;
        same: number;
        different: number;
        unsure: number;
        failed: number;
      };
      notify(
        `Read ${r.decided}: ${r.same} the same, ${r.different} different, ${r.unsure} unsure` +
          (r.failed ? ` (${r.failed} could not be read)` : ''),
      );
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Adjudication failed');
    } finally {
      adjudicating = false;
    }
  }

  // ── Bulk review ────────────────────────────────────────────────────────────
  //
  // Clearing this queue was one request and one confirmation per pair. That is
  // the bulk of the burden the graph puts on a person, and it got worse with
  // the mailbox: one person arrives as several entities depending on who typed
  // the header, so a sweep can surface dozens of pairs that are all obviously
  // the same decision. Selecting a batch and applying it in one call is the
  // difference between a minute and twenty.

  let selected = $state<Set<string>>(new Set());
  let batching = $state(false);

  const selectedRows = $derived(visible.filter((d) => selected.has(key(d))));
  const allVisibleSelected = $derived(visible.length > 0 && selectedRows.length === visible.length);

  function toggleSelected(d: DuplicateRow) {
    const k = key(d);
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    selected = next;
  }

  function selectAllVisible() {
    selected = allVisibleSelected ? new Set() : new Set(visible.map(key));
  }

  /** Select everything the matcher considers safe, so the obvious ones go in one go. */
  function selectAutoMergeable() {
    selected = new Set(visible.filter((d) => d.autoMergeable).map(key));
  }

  /** Rows the reader has ruled are one thing, among what is currently shown. */
  const confirmedRows = $derived(visible.filter((d) => d.decision?.verdict === 'same'));

  /**
   * Bring the reader's confirmations into view and select them.
   *
   * The filter change is the load-bearing half. On the first production run all
   * 49 confirmed pairs scored 0.49–0.55 on names alone — an abbreviation and its
   * expansion share few words, which is the whole reason a reader was needed —
   * so at the default 50% floor a third of them were not on the page at all.
   * A button that could only select what happened to be visible would have
   * reported the run's best output as "3 of 49".
   */
  async function selectConfirmed() {
    if (minConfidence > bandFloor) {
      minConfidence = bandFloor;
      await load();
    }
    selected = new Set(visible.filter((d) => d.decision?.verdict === 'same').map(key));
  }

  async function mergeSelected() {
    if (batching || !selectedRows.length) return;
    batching = true;
    const rows = selectedRows;
    try {
      const res = await fetch('/api/jkai/intel/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'merge-batch',
          pairs: rows.map((d) => ({ keepId: d.keep.id, mergeId: d.merge.id })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as {
        merged: number;
        failed: Array<{ keepId: string; mergeId: string; reason: string }>;
      };

      // Only clear the ones that actually merged. A pair can fail because
      // another tab — or the post-sweep auto-merge — already resolved one of
      // its endpoints, and hiding those would misreport what happened.
      const failedKeys = new Set((body.failed ?? []).map((f) => `${f.keepId}|${f.mergeId}`));
      const cleared = rows.filter((d) => !failedKeys.has(key(d))).map(key);
      done = new Set([...done, ...cleared]);
      selected = new Set();

      notify(
        body.failed?.length
          ? `Merged ${body.merged}; ${body.failed.length} could not be applied.`
          : `Merged ${body.merged} pair${body.merged === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Batch merge failed');
    } finally {
      batching = false;
    }
  }

  async function dismissSelected() {
    const rows = selectedRows;
    selected = new Set();
    for (const d of rows) await dismiss(d);
    notify(`Recorded ${rows.length} as different things`);
  }

  async function sweep(dryRun: boolean) {
    if (sweeping) return;
    sweeping = true;
    try {
      const res = await fetch('/api/jkai/intel/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'auto', threshold, dryRun }),
      });
      const body = await res.json();
      const r = body.result;
      notify(
        dryRun
          ? `Would merge ${r.merged} of ${r.candidates} candidates`
          : `Merged ${r.merged} entities (${r.skipped} skipped)`,
      );
      if (!dryRun) await load();
    } catch {
      notify('Sweep failed');
    } finally {
      sweeping = false;
    }
  }

</script>

<JkaiPageTitle title="INTEL / QUALITY" />

<div class="wrap">
  <p class="lede">
    Everything the graph tells you — importance, paths, clusters, surprising links — is only as good as
    whether one real thing is one node. These are the places it isn't.
  </p>
  <p class="lede-vs">
    This page fixes the SHAPE of the graph. To judge whether an individual entity is real or
    mis-typed, use <a href="/jkai/intel/review">Triage</a>; a duplicate you cannot decide here is
    usually a triage question about one of the two.
  </p>

  <section class="panel">
    <header>
      <h2>Duplicate entities</h2>
      <div class="tools">
        <label>
          Min confidence
          <select bind:value={minConfidence} onchange={load}>
            <option value={0.35}>35%</option>
            <!-- The floor of the adjudication band. "Select the N the reader
                 confirmed" drops the filter to exactly this, so it has to be a
                 value the control can actually display — otherwise the select
                 goes blank the moment that button is pressed. -->
            <option value={0.4}>40%</option>
            <option value={0.5}>50%</option>
            <option value={0.7}>70%</option>
            <option value={0.85}>85%</option>
          </select>
        </label>
        <button type="button" onclick={() => sweep(true)} disabled={sweeping}>Preview auto-merge</button>
        <button type="button" class="primary" onclick={() => sweep(false)} disabled={sweeping || !autoMergeable}>
          {sweeping ? 'Working…' : `Merge ${autoMergeable} confident`}
        </button>
        <button
          type="button"
          disabled={adjudicating || !undecidedInBand}
          title="Read the evidence behind the pairs the rules cannot settle, and record a verdict on each. Never merges anything."
          onclick={adjudicate}
        >{adjudicating ? 'Reading…' : `Adjudicate ${Math.min(undecidedInBand, 40)}`}</button>
      </div>
    </header>

    <!-- What the pass DID, not only what it is showing. Every number here was
         invisible before, and two of them (ruled out, held back) are the sweep
         withholding pairs — which is exactly the kind of decision that must
         never be silent. -->
    <div class="ledger">
      <button
        type="button"
        class="led"
        class:on={showRuledOut}
        disabled={!ruledOut && !adjudicatedApart}
        onclick={() => {
          showRuledOut = !showRuledOut;
          void load();
        }}
      >
        <b>{ruledOut}</b> answered
        {#if adjudicatedApart}<i>+{adjudicatedApart} by the reader</i>{/if}
      </button>
      <button
        type="button"
        class="led"
        class:go={confirmedSame > 0}
        disabled={!confirmedSame}
        title="Pairs the reader read the evidence for and ruled are one thing. Clicking drops the confidence floor far enough to show all of them, then selects them."
        onclick={selectConfirmed}
      >
        <b>{confirmedSame}</b> confirmed by the reader
      </button>
      <span class="led" title="Pairs whose names differ only in a number — two members of one series, held below the queue.">
        <b>{seriesVariants}</b> held back as a series
      </span>
      <span class="led" title="Candidate pairs the nearest-neighbour pass proposed. Lexical blocking can only ever propose two entities that share a word.">
        <b>{semanticPairs}</b> proposed by meaning
      </span>
      <span class="led"><b>{undecidedInBand}</b> in the band a reader can settle</span>
    </div>

    {#if loading}
      <p class="muted">Comparing every entity against every other…</p>
    {:else if showRuledOut && !visible.length}
      <p class="muted">Nothing has been answered yet at this confidence.</p>
    {:else if !visible.length}
      <p class="muted">No open duplicates at this confidence. The graph is clean.</p>
    {:else if showRuledOut}
      <p class="muted">
        Pairs already answered. A verdict from a person is final; one from the reader only pushes the
        pair below the floor, so it can still be brought back.
      </p>
    {:else}
      <p class="muted">
        {visible.length} shown of {total}. Above the {Math.round(threshold * 100)}% score threshold, identity checks determine eligibility to
        apply without reading it; below that, judgement is needed.
      </p>

      <div class="bulk">
        <label class="pick">
          <input type="checkbox" checked={allVisibleSelected} onchange={selectAllVisible} />
          Select all {visible.length}
        </label>
        <button type="button" class="ghost" onclick={selectAutoMergeable}>
          Select the {visible.filter((d) => d.autoMergeable).length} eligible pairs
        </button>
        {#if confirmedRows.length}
          <button type="button" class="ghost" onclick={selectConfirmed}>
            Select the {confirmedRows.length} confirmed
          </button>
        {/if}
        {#if selectedRows.length}
          <span class="picked">{selectedRows.length} selected</span>
          <button type="button" class="primary" disabled={batching} onclick={mergeSelected}>
            {batching ? 'Merging…' : `Merge ${selectedRows.length}`}
          </button>
          <button type="button" class="ghost" disabled={batching} onclick={dismissSelected}>
            Not duplicates
          </button>
        {/if}
      </div>

      <ul class="dups">
        {#each visible as d (key(d))}
          <li class="dup" class:auto={d.autoMergeable} class:is-selected={selected.has(key(d))}>
            <label class="rowpick">
              <input
                type="checkbox"
                checked={selected.has(key(d))}
                onchange={() => toggleSelected(d)}
                aria-label="Select {d.merge.name} to merge into {d.keep.name}"
              />
            </label>
            <div class="pair">
              <div class="side keep">
                <span class="tag">keep</span>
                <strong>{d.keep.name}</strong>
                <span class="meta">{d.keep.type} · {d.keep.degree} links · {d.keep.noteCount} sources</span>
              </div>
              <span class="fuse">←</span>
              <div class="side">
                <span class="tag drop">merge</span>
                <strong>{d.merge.name}</strong>
                <span class="meta">{d.merge.type} · {d.merge.degree} links · {d.merge.noteCount} sources</span>
              </div>
            </div>

            <p class="why">
              <span class="conf" class:high={d.autoMergeable}>{Math.round(d.confidence * 100)}%</span>
              {d.reason}
            </p>

            {#if d.decision}
              <p class="verdict" class:apart={d.decision.verdict === 'different'}>
                <span class="v-who">{d.decision.decidedBy === 'human' ? 'You' : 'The reader'}</span>
                said they are
                <b>{d.decision.verdict === 'different' ? 'different things' : d.decision.verdict === 'same' ? 'the same thing' : 'not clear'}</b>
                {#if d.decision.rationale}— {d.decision.rationale}{/if}
              </p>
            {/if}

            <div class="acts">
              <button type="button" class="primary" disabled={busy === key(d)} onclick={() => merge(d)}>
                {busy === key(d) ? 'Merging…' : 'Merge'}
              </button>
              <button type="button" disabled={busy === key(d)} onclick={() => merge(d, true)}>
                Merge the other way
              </button>
              {#if d.decision}
                <button type="button" class="ghost" onclick={() => undecide(d)}>Ask again</button>
              {:else}
                <button type="button" class="ghost" onclick={() => dismiss(d)}>Not a duplicate</button>
              {/if}
              <!-- Below the auto-merge line the question is "is this thing even
                   right", which is Triage's job, not this page's. -->
              <a class="ghost-link" href="/jkai/intel/review?focus={d.merge.id}">Judge in Triage</a>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <MentionReview />

  <!-- The taxonomy moved out.
       It used to be two panels here: proposed types as a list, and every type
       as a chip row with two 257-option <select>s. That is not a control
       anybody can use, and it is a different question from this page's — this
       page fixes which NODE a thing is; the taxonomy fixes which vocabulary
       describes it. `id="types"` stays because the "Tidy entity types" insight
       action links to it. -->
  <section class="panel" id="types">
    <header><h2>Entity types</h2></header>
    <p class="muted">
      The taxonomy — entity types and the categories on their sources — now has its own surface, with
      search, a status split and suggestions about what should be folded into what.
    </p>
    <a class="ghost-link" href="/jkai/intel/categories">Open the taxonomy →</a>
  </section>
</div>

{#if message}
  <div class="toast">{message}</div>
{/if}

<style>
  .lede-vs {
    margin: -6px 0 18px;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-ghost);
  }
  .lede-vs a {
    color: var(--accent);
  }
  .ghost-link {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 5px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    color: var(--text-ghost);
    text-decoration: none;
  }
  .ghost-link:hover {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }

  .wrap {
    padding: 20px;
    /* Full-bleed, like every Intel surface — a centred column beside a
       full-width graph read as a bug. Prose keeps its own measure below. */
    width: 100%;
  }
  .lede {
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0 0 18px;
    max-width: 68ch;
  }

  .panel {
    background: var(--card-bg);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    padding: 16px;
    margin-bottom: 16px;
  }
  .panel > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--accent-ink);
    font-weight: 500;
  }
  .muted {
    font-size: var(--fs-label);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0 0 12px;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tools label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    color: var(--text-ghost);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  select {
    padding: 5px 7px;
    font: inherit;
    font-size: var(--fs-label);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
  }
  button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 6px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  button.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    color: #fff;
  }
  button.ghost {
    border-color: transparent;
    color: var(--text-ghost);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .dups {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dup {
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    padding: 11px 13px;
  }
  .dup.auto {
    border-left-color: var(--accent);
  }
  /* NOT `.picked` — that is the "n selected" counter in the bulk bar, and it
     carries `margin-left: auto`. Sharing the name pushed every selected row
     to the right and shrank it to its content width. */
  .dup.is-selected {
    border-color: var(--accent-tint-35);
    border-left-color: var(--accent);
  }

  /* The row checkbox sits above the pair rather than beside it, so selecting
     does not squeeze the two names it is a decision about. */
  .rowpick {
    display: block;
    margin-bottom: 6px;
    cursor: pointer;
  }
  .rowpick input {
    cursor: pointer;
  }

  .bulk {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 9px;
    padding: 8px 11px;
    margin-bottom: 10px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .picked {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    margin-left: auto;
  }

  .pair {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 180px;
    flex: 1;
  }
  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--success);
  }
  .tag.drop {
    color: var(--text-ghost);
  }
  .side strong {
    font-size: var(--fs-body-sm);
    font-weight: 600;
    word-break: break-word;
  }
  .side.keep strong {
    color: var(--text-primary);
  }
  .meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .fuse {
    color: var(--accent);
    font-size: var(--fs-body-lg);
  }

  .why {
    margin: 9px 0 9px;
    font-size: var(--fs-label);
    color: var(--text-secondary);
    line-height: 1.45;
  }
  .conf {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 1px 6px;
    border-radius: var(--radius-sharp);
    background: var(--line);
    color: var(--text-muted);
    margin-right: 6px;
  }
  .conf.high {
    background: var(--accent-tint-14);
    color: var(--accent);
  }

  .acts {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 12px;
  }
  .chip {
    font-size: var(--fs-label-xs);
    padding: 3px 9px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
  }
  .chip b {
    color: var(--warn);
  }

  .type-merge {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid var(--line-hair);
  }
  .type-merge span {
    color: var(--text-ghost);
  }

  /* The honesty row: what the sweep did, beside what it is showing. */
  .ledger {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 12px;
  }
  .led {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 4px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  button.led {
    cursor: pointer;
  }
  button.led:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button.led:not(:disabled):hover {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  button.led.go:not(:disabled) {
    border-color: var(--success);
  }
  button.led.go:not(:disabled) b {
    color: var(--success);
  }
  button.led.on {
    background: var(--accent-tint-08);
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .led b {
    color: var(--accent-ink);
    font-weight: 500;
  }
  .led i {
    font-style: normal;
    color: var(--text-ghost);
  }

  .verdict {
    margin: 4px 0 0;
    font-size: var(--fs-label);
    color: var(--text-muted);
    line-height: 1.45;
  }
  .verdict.apart {
    color: var(--text-ghost);
  }
  .v-who {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent-ink);
  }

  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    background: var(--surface-elevated);
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-round);
    padding: 9px 16px;
    font-size: var(--fs-label);
  }
</style>
