<script lang="ts">
  // One epic, opened.
  //
  // What this replaces: a panel where the epic's own settings were folded into
  // a `<details>` labelled "Edit epic definition", the priority was two separate
  // rows of five identical ghost buttons — one of them scoped to "open
  // deliverables" and the other to a single row, with nothing on either saying
  // so — and every deliverable carried eight equal-weight buttons in a wrapped
  // line. Everything was the same size, so nothing was.
  //
  // The shape here is /health's: SETTINGS first, as a form with visible labels
  // and one save; then the deliverables as a LEDGER, on the tripwire table's
  // rules — 14px top-aligned rows, a two-line name cell, and the explaining
  // sentence in body font in a column of its own rather than crushed under the
  // title.
  import DrillPanel from '$lib/components/jkai/daydream/hub/DrillPanel.svelte';
  import BacklogEditor from './BacklogEditor.svelte';
  import { matchClaim, sharedTerms, stepPriority } from '$lib/selfimprove/backlog-board';
  import { STAGE_META, kindLabel, type WorkItem } from '$lib/selfimprove/board';
  import type { BacklogEpic } from '$lib/selfimprove/epic-backlog';
  import { ago } from '$lib/daydream/format';

  interface Props {
    epic: BacklogEpic;
    busy: string | null;
    act: (body: Record<string, unknown>, key: string) => Promise<boolean>;
    onclose: () => void;
  }

  let { epic, busy, act, onclose }: Props = $props();

  // ── Settings ────────────────────────────────────────────────────────────
  // Seeded from the epic ONCE, at mount, and never synced back from the prop.
  // The panel is keyed on the slug by its parent, so opening a different epic
  // remounts it — which is what makes a prop→state sync effect (and its
  // documented re-tracking loop) unnecessary here.
  let title = $state(epic.title);
  let summary = $state(epic.summary);
  let priority = $state(epic.priority);
  const dirty = $derived(
    title.trim() !== epic.title || summary.trim() !== epic.summary.trim() || priority !== epic.priority,
  );
  const saving = $derived(busy === `epic:${epic.slug}`);

  /** Deliverables the epic-level priority actually rewrites. Said on the
   *  control, because "set priority" over a mixed epic silently skipping the
   *  shipped half is the ambiguity this panel had. */
  const repriced = $derived(
    epic.deliverables.filter((i) => i.source === 'backlog' && i.backlogStatus === 'open' && !i.foldedInto),
  );

  async function save() {
    if (!title.trim() || saving) return;
    await act(
      {
        action: 'epic_update',
        slug: epic.slug,
        title: title.trim(),
        summary: summary.trim(),
        ...(priority !== epic.priority ? { priority } : {}),
      },
      `epic:${epic.slug}`,
    );
  }

  function revert() {
    title = epic.title;
    summary = epic.summary;
    priority = epic.priority;
  }

  // ── The ledger ──────────────────────────────────────────────────────────
  let showHistory = $state(false);
  let search = $state('');
  let editing = $state<string | null>(null);
  let adding = $state(false);

  const rows = $derived(
    epic.deliverables.filter(
      (i) =>
        (showHistory || i.stage !== 'parked') &&
        [i.title, i.detail, i.kind].join(' ').toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  const parked = $derived(epic.deliverables.filter((i) => i.stage === 'parked').length);
  const edited = $derived(
    [...epic.deliverables, ...epic.combinedDeliveries].find((i) => i.id === editing) ?? null,
  );

  function suggestionsFor(item: WorkItem) {
    return (epic.suggestions ?? []).filter((s) => s.itemId === item.id);
  }
  function keptSeparate(item: WorkItem): boolean {
    return epic.groomingOverrides?.includes(item.id) ?? false;
  }

  function itemState(item: WorkItem): { label: string; tone: string } {
    if (item.foldedInto) return { label: 'COMBINED', tone: 'quiet' };
    return { label: STAGE_META[item.stage].label.toUpperCase(), tone: STAGE_META[item.stage].tone };
  }

  /** The one sentence a row gets. A failure outranks the brief, because the
   *  brief is what you wanted and the failure is what happened. */
  function why(item: WorkItem): string {
    if (item.lastError) return `Attempt ${item.attempts} failed — ${item.lastError}`;
    if (item.parkedReason) return item.parkedReason;
    return item.detail || '—';
  }

  const applied = $derived((epic.groomingHistory ?? []).filter((a) => a.state === 'applied'));
</script>

<DrillPanel
  wide
  label={epic.title}
  kicker="Epic / {epic.deliverables.length} deliverable{epic.deliverables.length === 1 ? '' : 's'}"
  tone={STAGE_META[epic.stage].tone}
  {onclose}
>
  {#snippet head()}
    <span class="pill t-{STAGE_META[epic.stage].tone}">{STAGE_META[epic.stage].label}</span>
    <span class="pill">P{epic.priority}</span>
    {#if epic.suggestions?.length}
      <span class="pill t-action">{epic.suggestions.length} to review</span>
    {/if}
  {/snippet}

  {#if editing || adding}
    <button type="button" class="btn sm back" onclick={() => { editing = null; adding = false; }}>
      ← All deliverables
    </button>
    {#key editing ?? 'new'}
      <BacklogEditor
        item={edited}
        embedded
        epicSlug={epic.slug}
        onclose={() => { editing = null; adding = false; }}
      />
    {/key}
  {:else}
    <!-- ── Settings ──────────────────────────────────────────────────────
         Visible, not behind a disclosure. This is the panel's primary job:
         an automatically-grouped epic arrives with a machine-made label and
         no outcome at all, so naming it is the first thing anyone does here. -->
    <section class="set">
      <h3 class="set-hd">Settings</h3>
      <div class="set-grid">
        <label class="field">
          <span class="field-label">Epic title</span>
          <input class="text-input" bind:value={title} maxlength="200" />
          <span class="hint">
            Overrides the label grouping gave it. {epic.title === title.trim() ? 'Currently automatic.' : ''}
          </span>
        </label>

        <label class="field">
          <span class="field-label">Outcome</span>
          <textarea class="text-input area" bind:value={summary} rows="3" maxlength="2000"></textarea>
          <span class="hint">What is true once every deliverable below has landed.</span>
        </label>

        <div class="field">
          <span class="field-label">Priority</span>
          <div class="pri">
            <button
              type="button"
              class="step-btn"
              disabled={priority <= 1}
              aria-label="Raise to priority {priority - 1}"
              onclick={() => (priority = stepPriority(priority, -1))}
            >▲</button>
            <span class="pri-n" class:p1={priority === 1}>P{priority}</span>
            <button
              type="button"
              class="step-btn"
              disabled={priority >= 5}
              aria-label="Lower to priority {priority + 1}"
              onclick={() => (priority = stepPriority(priority, 1))}
            >▼</button>
          </div>
          <span class="hint">
            {#if repriced.length === 0}
              Nothing open here to rank — every deliverable has shipped or been parked.
            {:else}
              Writes to {repriced.length} open deliverable{repriced.length === 1 ? '' : 's'}. It is
              the field <code>pickWork</code> ranks on, so it decides what gets built tonight.
            {/if}
          </span>
        </div>
      </div>

      <div class="set-acts">
        <button type="button" class="cta sm" disabled={!dirty || !title.trim() || saving} onclick={save}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <button type="button" class="btn sm" disabled={!dirty || saving} onclick={revert}>Revert</button>
        <span class="hint">{dirty ? 'Unsaved changes.' : `Last touched ${ago(epic.updatedAt)}.`}</span>
      </div>
    </section>

    <!-- ── Deliverables ─────────────────────────────────────────────────── -->
    <section class="led">
      <div class="led-hd">
        <h3 class="set-hd">Deliverables</h3>
        <input
          class="text-input led-search"
          type="search"
          bind:value={search}
          placeholder="find a deliverable…"
          aria-label="Find a deliverable in this epic"
        />
        {#if parked > 0}
          <button
            type="button"
            class="btn sm"
            class:picked={showHistory}
            aria-pressed={showHistory}
            onclick={() => (showHistory = !showHistory)}
          >{showHistory ? 'Hide' : 'Show'} {parked} parked</button>
        {/if}
        <button type="button" class="cta sm" onclick={() => (adding = true)}>+ Add deliverable</button>
      </div>

      <div class="tbl-wrap">
        <table class="tbl">
          <colgroup>
            <col style="width: 104px" />
            <col style="width: 30%" />
            <col />
            <col style="width: 190px" />
          </colgroup>
          <thead>
            <tr>
              <th>State</th>
              <th>Deliverable</th>
              <th>What it says</th>
              <th class="right">Rank · move</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as item (item.id)}
              {@const st = itemState(item)}
              {@const rowBusy = busy === `row:${item.id}`}
              <tr class:dim={item.stage === 'parked' || Boolean(item.foldedInto)}>
                <td>
                  <span class="pill t-{st.tone}">{st.label}</span>
                </td>
                <td class="cell-wrap">
                  <button type="button" class="cell-title" onclick={() => (editing = item.id)}>
                    {item.title.replace(/^Epic:\s*/i, '')}
                  </button>
                  <span class="mark">{kindLabel(item.kind)}{item.attempts ? ` · ${item.attempts} tries` : ''}</span>
                </td>
                <td class="cell-wrap why">
                  {why(item)}
                  {#if item.absorbedRequirements && Object.keys(item.absorbedRequirements).length}
                    <details class="folded">
                      <summary>Merged requirements ({Object.keys(item.absorbedRequirements).length})</summary>
                      {#each Object.values(item.absorbedRequirements) as brief, i (i)}<pre>{brief}</pre>{/each}
                    </details>
                  {/if}
                  {#if item.grooming?.acceptanceCriteria.length}
                    <details class="folded">
                      <summary>Acceptance criteria ({item.grooming.acceptanceCriteria.length})</summary>
                      <ul>
                        {#each item.grooming.acceptanceCriteria as c, i (i)}<li>{c}</li>{/each}
                      </ul>
                    </details>
                  {/if}
                </td>
                <td class="right"><div class="act-stack">
                  {#if item.source === 'backlog' && !item.foldedInto}
                    <div class="pri sm">
                      <button
                        type="button"
                        class="step-btn"
                        disabled={rowBusy || item.priority <= 1 || item.backlogStatus !== 'open'}
                        aria-label="Raise {item.title} to priority {item.priority - 1}"
                        onclick={() => act({ action: 'backlog_priority', slug: item.slug, priority: stepPriority(item.priority, -1) }, `row:${item.id}`)}
                      >▲</button>
                      <span class="pri-n" class:p1={item.priority === 1}>P{item.priority}</span>
                      <button
                        type="button"
                        class="step-btn"
                        disabled={rowBusy || item.priority >= 5 || item.backlogStatus !== 'open'}
                        aria-label="Lower {item.title} to priority {item.priority + 1}"
                        onclick={() => act({ action: 'backlog_priority', slug: item.slug, priority: stepPriority(item.priority, 1) }, `row:${item.id}`)}
                      >▼</button>
                    </div>
                    {#if item.backlogStatus !== 'shipped'}
                      <button
                        type="button"
                        class="btn sm"
                        disabled={rowBusy}
                        onclick={() => act({ action: 'backlog_park', slug: item.slug, parked: item.backlogStatus !== 'abandoned', reason: 'Parked from the epic ledger' }, `row:${item.id}`)}
                      >{item.backlogStatus === 'abandoned' ? 'Restore' : 'Park'}</button>
                    {/if}
                  {:else if item.source === 'capability' && item.stage === 'proposed'}
                    <button
                      type="button"
                      class="cta sm"
                      disabled={rowBusy}
                      onclick={() => act({ action: 'capability_decide', slug: item.slug, decision: 'accept' }, `row:${item.id}`)}
                    >Accept</button>
                    <button
                      type="button"
                      class="btn sm"
                      disabled={rowBusy}
                      onclick={() => act({ action: 'capability_decide', slug: item.slug, decision: 'decline' }, `row:${item.id}`)}
                    >Decline</button>
                  {:else if item.foldedInto}
                    <button type="button" class="btn sm" onclick={() => (editing = `backlog:${item.foldedInto}`)}>
                      Open delivery
                    </button>
                  {/if}
                  {#if item.artifactHref}<a class="btn sm" href={item.artifactHref}>Result →</a>{/if}
                  </div></td>
              </tr>

              <!-- A suggestion is a question about THIS row, so it belongs
                   under it rather than in a separate queue the row links to. -->
              {#each suggestionsFor(item) as s (s.id)}
                {@const terms = sharedTerms(item.title, s.targetTitle)}
                <tr class="sug">
                  <td></td>
                  <td colspan="3">
                    <div class="sug-box">
                      <p class="sug-hd">
                        <span class="mark">{s.kind === 'covered' ? 'Possibly already covered' : 'Suggested merge'}</span>
                        {s.targetTitle}
                      </p>
                      <p class="sug-why">{matchClaim(s.reason)}</p>
                      {#if terms.length}
                        <p class="sug-terms">
                          {#each terms as t (t)}<span class="term">{t}</span>{/each}
                        </p>
                      {/if}
                      <div class="sug-acts">
                        <button
                          type="button"
                          class="cta sm"
                          disabled={busy === `sug:${s.id}`}
                          onclick={() => act({ action: 'backlog_grooming_decide', id: s.id, decision: 'apply' }, `sug:${s.id}`)}
                        >{s.kind === 'covered' ? 'Retire this one' : 'Merge requirements'}</button>
                        <button
                          type="button"
                          class="btn sm"
                          disabled={busy === `sug:${s.id}`}
                          onclick={() => act({ action: 'backlog_grooming_decide', id: s.id, decision: 'keep' }, `sug:${s.id}`)}
                        >Keep separate</button>
                        {#if s.targetHref}<a class="btn sm" href={s.targetHref}>Inspect the existing one →</a>{/if}
                      </div>
                    </div>
                  </td>
                </tr>
              {/each}

              {#if keptSeparate(item)}
                <tr class="sug">
                  <td></td>
                  <td colspan="3">
                    <p class="pinned">
                      Pinned apart — automatic grouping will not fold this in.
                      <button
                        type="button"
                        class="link-btn"
                        disabled={busy === `sep:${item.id}`}
                        onclick={() => act({ action: 'backlog_grooming_override', itemId: item.id, keepSeparate: false }, `sep:${item.id}`)}
                      >Allow merging again</button>
                    </p>
                  </td>
                </tr>
              {/if}
            {:else}
              <tr><td colspan="4"><p class="note">No deliverable matches that.</p></td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    {#if applied.length}
      <details class="hist">
        <summary>What was consolidated automatically ({applied.length})</summary>
        {#each [...applied].reverse() as entry (entry.id)}
          <div class="hist-row">
            <div>
              <p class="hist-t">{entry.itemTitle}</p>
              <p class="hist-s">
                {entry.kind === 'merge' ? 'Requirements merged into' : 'Retired as covered by'}
                {entry.targetTitle} · {ago(entry.at)} · by {entry.by}
              </p>
            </div>
            <button
              type="button"
              class="btn sm"
              disabled={busy === `undo:${entry.itemId}`}
              onclick={() => act({ action: 'backlog_grooming_override', itemId: entry.itemId, keepSeparate: true }, `undo:${entry.itemId}`)}
            >Restore separately</button>
          </div>
        {/each}
      </details>
    {/if}

    <p class="note">
      Grouping is automatic and reversible: restoring a deliverable also pins it apart, so the
      next intake pass cannot fold it back in.
    </p>
  {/if}
</DrillPanel>

<style>
  .back {
    margin-bottom: 14px;
  }

  .set-hd {
    font-family: var(--font-display);
    font-size: var(--fs-body);
    line-height: 1;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    margin: 0;
  }

  .set {
    padding-bottom: 22px;
    border-bottom: 1px solid var(--line-hair);
  }
  .set-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 190px;
    gap: 16px clamp(14px, 2vw, 26px);
    margin: 16px 0 14px;
    align-items: start;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  /* The shared `.text-input` carries `flex: 1 1 220px` for the horizontal
     control bars it was written for. In a flex COLUMN that reads as "grow
     down", and a one-line title field rendered 220px tall. */
  .field :global(.text-input) {
    flex: 0 0 auto;
  }
  .hint {
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .set-acts {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pri {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--line-strong);
    align-self: start;
  }
  .pri-n {
    font-family: var(--font-display);
    font-size: var(--fs-body);
    line-height: 1;
    padding: 0 10px;
    color: var(--text-secondary);
  }
  .pri.sm .pri-n {
    font-size: var(--fs-label);
    padding: 0 7px;
  }
  .pri-n.p1 {
    color: var(--accent);
  }
  .step-btn {
    border: 0;
    background: none;
    padding: 6px 9px;
    font-size: var(--fs-label-xs);
    line-height: 1.2;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .pri.sm .step-btn {
    padding: 3px 6px;
  }
  .step-btn:hover:not(:disabled) {
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  .step-btn:disabled {
    color: var(--text-ghost);
    cursor: not-allowed;
  }

  /* ── ledger ───────────────────────────────────────────────────────────── */
  .led {
    padding-top: 22px;
  }
  .led-hd {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .led-search {
    flex: 1 1 200px;
    width: auto;
    min-width: 160px;
  }

  .tbl {
    /* Fixed, with the colgroup above: `auto` lets the widest brief in the
       ledger push the action column off its track and over the text. And a
       floor under the measure, so a narrow panel scrolls the ledger sideways
       rather than squeezing four tracks into a word each. */
    table-layout: fixed;
    min-width: 760px;
  }
  .tbl :global(td) {
    vertical-align: top;
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
  /* The explaining sentence gets BODY font and a column of its own — the
     tripwire ledger's rule, and the reason this reads rather than scans. */
  .why {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
    min-width: 30ch;
  }
  /* The flex lives on a DIV inside the cell, never on the `<td>` itself. */
  .act-stack {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    justify-content: flex-end;
    align-items: center;
  }

  .folded {
    margin-top: 6px;
  }
  .folded summary {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-ink);
    cursor: pointer;
  }
  .folded pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    max-height: 220px;
    overflow: auto;
    margin: 6px 0 0;
  }
  .folded ul {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: var(--fs-label);
    line-height: 1.5;
  }

  /* ── a suggestion ─────────────────────────────────────────────────────── */
  .sug > td {
    padding-top: 0;
  }
  .sug-box {
    border-left: 3px solid var(--accent-ink);
    background: var(--bg-section);
    padding: 10px 12px;
    margin-bottom: 4px;
  }
  .sug-hd {
    margin: 0 0 4px;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .sug-hd .mark {
    display: block;
    margin-bottom: 3px;
  }
  .sug-why {
    margin: 0 0 8px;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .sug-terms {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0 0 8px;
  }
  .term {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border: 1px solid var(--line-hair);
    color: var(--accent-ink);
  }
  .sug-acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pinned {
    margin: 0 0 6px;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .link-btn {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }

  /* ── history ──────────────────────────────────────────────────────────── */
  .hist {
    margin-top: 22px;
    border-top: 1px solid var(--line-hair);
    padding-top: 14px;
  }
  .hist summary {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-ink);
    cursor: pointer;
  }
  .hist-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line-hair);
  }
  .hist-t {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .hist-s {
    margin: 3px 0 0;
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  @media (max-width: 900px) {
    .set-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
