<script lang="ts">
  // C (owner) — THE VERSION LOG. Every deploy in the filtered set, newest
  // first, with the evidence under it.
  //
  // This is what used to be /admin/ops/releases. It reads the SAME URL params
  // as the public half, so a filter typed on one is the same link on the other
  // — the difference between the two views is the depth of what comes back, not
  // the grammar of how you ask for it.
  //
  // Everything below the fold here is owner-only for one reason: commit prose
  // quotes the data that provoked the change. That is how a personal phone
  // number reached the public internet on 2026-07-29 — the summariser reported
  // it faithfully from the commit body that carried it as a test case. Shas,
  // file paths, includes/excludes and the raw diff never cross to the anonymous
  // payload, and the loader is what stops them, not this template.
  import { KIND_LABEL, type CommitFact, type FileFact, type ReleaseItemKind } from '$lib/releases/types';
  import type { ConsoleFilters, ConsoleRelease } from '$lib/releases/console';

  interface Props {
    items: ConsoleRelease[];
    filters: ConsoleFilters;
    hasMore: boolean;
    busy?: boolean;
    /** Re-run the summariser over one release. */
    onRegenerate: (id: number, version: string) => void;
  }

  let { items, filters, hasMore, busy = false, onRegenerate }: Props = $props();

  // Per-card UI state, keyed by release id. Reassigned wholesale (not mutated)
  // so the template's reads stay reactive.
  let expanded = $state<Record<number, boolean>>({});
  let evidenceOpen = $state<Record<number, boolean>>({});

  type RawView = { version: string; commits: CommitFact[]; files: FileFact[] };
  let raw = $state<RawView | null>(null);

  function toggle(id: number) {
    expanded = { ...expanded, [id]: !expanded[id] };
  }
  function toggleEvidence(id: number) {
    evidenceOpen = { ...evidenceOpen, [id]: !evidenceOpen[id] };
  }

  /** Portal to <body> so the overlay escapes the page's stacking context.
   *  Local, not $lib/canvas/portal — that one re-appends the node on destroy
   *  and resurrects the overlay, leaving a stuck-open modal with a dead ✕. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function fmtNum(n: number): string {
    return n.toLocaleString('en-GB');
  }
  function fmtDate(d: Date | string | null): string {
    if (!d) return '—';
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Carry the whole filter across a page step; drop the empty and default parts. */
  function qs(patch: Record<string, string | number>): string {
    const p = new URLSearchParams();
    const merged = { ...filters, ...patch } as Record<string, string | number>;
    for (const [k, v] of Object.entries(merged)) {
      if (v === '' || v === 'all' || v === 0) continue;
      p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  }
</script>

{#if items.length === 0}
  <p class="vl-empty">
    No releases match. Run <code>node scripts/release-log/ingest.mjs --backfill</code> to reconstruct
    history from git.
  </p>
{:else}
  <div class="vl">
    {#each items as r (r.id)}
      <article class="rel" class:open={expanded[r.id]}>
        <button class="rel-hd" onclick={() => toggle(r.id)} aria-expanded={expanded[r.id] ?? false}>
          <span class="rel-ver">{r.version}</span>
          <span class="rel-titles">
            <span class="rel-title">{r.title ?? r.commits[0]?.subject ?? r.shortSha}</span>
            <span class="rel-meta">
              <span class="rel-date">{fmtDate(r.deployedAt)}</span>
              {#if r.via !== 'github-actions'}<span class="chip via">{r.via}</span>{/if}
              {#each r.kinds as k (k)}<span class="chip">{KIND_LABEL[k] ?? k}</span>{/each}
              {#if r.summaryStatus === 'pending'}<span class="chip warn">awaiting summary</span>{/if}
              {#if r.summaryStatus === 'failed'}<span class="chip bad">summary failed</span>{/if}
            </span>
          </span>
          <span class="rel-churn">
            <span class="ins">+{fmtNum(r.stats.insertions ?? 0)}</span>
            <span class="del">−{fmtNum(r.stats.deletions ?? 0)}</span>
          </span>
          <span class="rel-counts">{r.stats.commits ?? 0}c · {r.stats.files ?? 0}f</span>
          <span class="rel-chev" aria-hidden="true">{expanded[r.id] ? '▾' : '▸'}</span>
        </button>

        {#if expanded[r.id]}
          <div class="rel-body">
            {#if r.summary}<p class="rel-summary">{r.summary}</p>{/if}

            <p class="prov">
              <span title="deployed commit">{r.shortSha}</span>
              <span class="prov-sep">←</span>
              <span title="commit it replaced">{r.prevSha ? r.prevSha.slice(0, 8) : 'root'}</span>
              {#if r.via === 'backfill'}
                <span class="prov-note">
                  reconstructed from git history — boundary and time approximate
                </span>
              {/if}
            </p>

            {#if r.items.length === 0}
              <p class="vl-empty small">
                {r.summaryStatus === 'pending'
                  ? 'Not summarised yet.'
                  : 'No entries — this deploy shipped no code changes.'}
              </p>
            {:else}
              <div class="items">
                {#each r.items as it (it.id)}
                  <div class="item">
                    <div class="item-top">
                      <span class="kind-badge" data-kind={it.kind}>{KIND_LABEL[it.kind] ?? it.kind}</span>
                      {#if it.impact === 'user-facing'}<span class="chip pub">user-facing</span>{/if}
                      <span class="item-title">{it.title}</span>
                      {#if it.confidence === 'low'}
                        <span class="chip warn" title="Thin evidence — read the commits below">
                          low confidence
                        </span>
                      {/if}
                    </div>
                    {#if it.summary}<p class="item-sum">{it.summary}</p>{/if}

                    {#if it.includes.length || it.excludes.length}
                      <div class="scope">
                        {#if it.includes.length}
                          <div class="scope-col">
                            <span class="scope-hd">Includes</span>
                            <ul class="scope-list yes">
                              {#each it.includes as line, i (i)}<li>{line}</li>{/each}
                            </ul>
                          </div>
                        {/if}
                        {#if it.excludes.length}
                          <div class="scope-col">
                            <span class="scope-hd">Not included</span>
                            <ul class="scope-list no">
                              {#each it.excludes as line, i (i)}<li>{line}</li>{/each}
                            </ul>
                          </div>
                        {/if}
                      </div>
                    {/if}

                    {#if it.surfaces.length}
                      <div class="surfaces">
                        {#each it.surfaces as s, i (i)}<span class="surface-chip">{s}</span>{/each}
                      </div>
                    {/if}

                    {#if it.files.length || it.commits.length}
                      <details class="evidence">
                        <summary>Evidence · {it.files.length} files · {it.commits.length} commits</summary>
                        <div class="evidence-body">
                          {#each it.commits as c, i (i)}<span class="ev-commit">{c}</span>{/each}
                          <ul class="ev-files">
                            {#each it.files as f, i (i)}<li>{f}</li>{/each}
                          </ul>
                        </div>
                      </details>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            <div class="rel-actions">
              <button
                class="act"
                onclick={() => (raw = { version: r.version, commits: r.commits, files: r.files })}
              >
                Full diff detail
              </button>
              <button class="act" onclick={() => toggleEvidence(r.id)}>
                {evidenceOpen[r.id] ? 'Hide' : 'Show'} commit list
              </button>
              <button class="act" disabled={busy} onclick={() => onRegenerate(r.id, r.version)}>
                Regenerate summary
              </button>
              {#if r.summaryModel}<span class="model-note">{r.summaryModel}</span>{/if}
            </div>

            {#if evidenceOpen[r.id]}
              <ul class="commit-list">
                {#each r.commits as c (c.sha)}
                  <li>
                    <span class="sha">{c.short}</span>
                    <span class="c-subject">{c.subject}</span>
                    {#if c.pr}<span class="chip">#{c.pr}</span>{/if}
                  </li>
                {/each}
              </ul>
            {/if}

            {#if r.summaryError}
              <p class="err-note">{r.summaryError}</p>
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  </div>

  <div class="pager">
    {#if filters.page > 0}
      <a class="page-btn" href={qs({ page: filters.page - 1 })}>← Newer</a>
    {:else}<span></span>{/if}
    <span class="page-at">Page {filters.page + 1}</span>
    {#if hasMore}
      <a class="page-btn" href={qs({ page: filters.page + 1 })}>Older →</a>
    {:else}<span></span>{/if}
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && raw) raw = null;
  }}
/>

{#if raw}
  <!-- The house overlay shape (see OpenRouterModelPicker): a backdrop that
       closes on click, Escape on the window, and the two ignores that come with
       a backdrop being a backdrop rather than a control. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="raw-overlay" use:portal onclick={() => (raw = null)}>
    <div
      class="raw-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Release detail"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="raw-hd">
        <span class="raw-stage">{raw.version}</span>
        <span class="raw-title">{raw.commits.length} commits · {raw.files.length} files</span>
        <button class="raw-close" onclick={() => (raw = null)} aria-label="Close">✕</button>
      </div>
      <div class="raw-body">
        <div class="raw-sec">Commits</div>
        <ul class="commit-list detail">
          {#each raw.commits as c (c.sha)}
            <li>
              <span class="sha">{c.short}</span>
              <span class="c-subject">{c.subject}</span>
              {#if c.pr}<span class="chip">#{c.pr}</span>{/if}
              {#if c.body}<pre class="c-body">{c.body}</pre>{/if}
            </li>
          {/each}
        </ul>
        <div class="raw-sec">Files</div>
        <table class="file-table">
          <colgroup>
            <col style="width:auto" /><col style="width:70px" /><col style="width:70px" /><col
              style="width:38px"
            />
          </colgroup>
          <tbody>
            {#each raw.files as f (f.path)}
              <tr>
                <td class="f-path">{f.path}</td>
                <td class="ins">+{f.insertions}</td>
                <td class="del">−{f.deletions}</td>
                <td class="f-status">{f.status}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── the log ───────────────────────────────────────────────────────── */
  .vl {
    display: flex;
    flex-direction: column;
  }
  .rel {
    border-bottom: 1px solid var(--line-hair);
  }
  .rel.open {
    background: var(--accent-tint-04);
  }

  /* A numeral, a column saying what the thing IS, then the content — the
     ranked-moves row from /health, with the churn and counts trailing. */
  .rel-hd {
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr) 10rem 5.5rem 1.4rem;
    align-items: baseline;
    gap: 16px;
    width: 100%;
    padding: 15px 0;
    background: none;
    border: none;
    border-radius: 0;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .rel-hd:hover .rel-title {
    color: var(--accent);
  }
  .rel-hd:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .rel-ver {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .rel-titles {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
  }
  .rel-title {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-primary);
    overflow-wrap: anywhere;
    transition: color 0.2s ease-out;
  }
  .rel-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .rel-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .rel-churn,
  .rel-counts,
  .rel-chev {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
    color: var(--text-ghost);
  }
  .rel-churn {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .rel-counts,
  .rel-chev {
    text-align: right;
  }
  .ins {
    color: var(--success);
  }
  .del {
    color: var(--error);
  }

  @media (max-width: 860px) {
    .rel-hd {
      grid-template-columns: minmax(0, 1fr) 1.4rem;
      row-gap: 8px;
    }
    .rel-ver {
      grid-column: 1;
    }
    .rel-chev {
      grid-row: 1;
      grid-column: 2;
    }
    .rel-titles,
    .rel-churn,
    .rel-counts {
      grid-column: 1 / -1;
    }
    .rel-churn {
      justify-content: flex-start;
    }
    .rel-counts {
      text-align: left;
    }
  }

  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 2px 7px;
    border: 1px solid var(--line-strong);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .chip.via {
    border-color: var(--accent-ink);
    color: var(--accent-ink);
  }
  .chip.warn {
    border-color: var(--warn);
    color: var(--warn);
  }
  .chip.bad {
    border-color: var(--error);
    color: var(--error);
  }
  .chip.pub {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ── the expanded body ─────────────────────────────────────────────── */
  .rel-body {
    padding: 4px 0 26px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .rel-summary {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0;
    max-width: 78ch;
  }
  .prov {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    margin: 0;
  }
  .prov-sep {
    color: var(--accent);
  }
  .prov-note {
    color: var(--warn);
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--line-hair);
    border: 1px solid var(--line-hair);
  }
  .item {
    background: var(--bg);
    padding: 15px 16px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .item-top {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .kind-badge {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 2px 8px;
    background: var(--text-primary);
    color: var(--bg);
    white-space: nowrap;
  }
  .kind-badge[data-kind='feature'] {
    background: var(--accent);
  }
  .kind-badge[data-kind='fix'] {
    background: var(--accent-ink);
  }
  .item-title {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .item-sum {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
    margin: 0;
    max-width: 78ch;
    overflow-wrap: anywhere;
  }

  .scope {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 14px;
  }
  .scope-hd {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-bottom: 6px;
  }
  .scope-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .scope-list li::before {
    font-family: var(--font-mono);
    margin-right: 7px;
  }
  .scope-list.yes li::before {
    content: '+';
    color: var(--success);
  }
  .scope-list.no li::before {
    content: '−';
    color: var(--text-ghost);
  }

  .surfaces {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .surface-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: var(--accent-ink);
    border: 1px solid var(--line-hair);
    padding: 2px 7px;
    overflow-wrap: anywhere;
  }

  .evidence {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .evidence summary {
    cursor: pointer;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .evidence summary:hover {
    color: var(--accent);
  }
  .evidence-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 0 0 14px;
    color: var(--text-muted);
  }
  .ev-commit {
    color: var(--accent-ink);
  }
  .ev-files {
    margin: 0;
    padding-left: 14px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow-wrap: anywhere;
  }

  .rel-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .act {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 7px 12px;
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      border-color 0.2s ease-out,
      color 0.2s ease-out;
  }
  .act:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .act:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .model-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .commit-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .commit-list li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .sha {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
  }
  .c-subject {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .c-body {
    flex-basis: 100%;
    margin: 4px 0 0;
    padding: 8px 10px;
    background: var(--surface-elevated);
    border-left: 2px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .err-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--error);
    margin: 0;
  }

  .vl-empty {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
  .vl-empty.small {
    font-size: var(--fs-label);
    margin: 0;
  }
  .vl-empty code {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: var(--surface-elevated);
    padding: 2px 6px;
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 26px;
    padding-top: 20px;
    border-top: 1px solid var(--line-strong);
  }
  .page-btn,
  .page-at {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .page-btn {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }
  .page-btn:hover {
    border-bottom-color: var(--accent);
  }
  .page-at {
    color: var(--text-ghost);
  }

  /* ── the raw-diff modal ────────────────────────────────────────────── */
  .raw-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(26, 16, 8, 0.62);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  /* OPAQUE, not --card-bg: that token is a 7% tint and reads as transparent
     the moment it is used as a panel ground. */
  .raw-modal {
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    width: min(1000px, 100%);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .raw-hd {
    display: flex;
    align-items: baseline;
    gap: 14px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--line-strong);
    background: var(--surface-elevated);
  }
  .raw-stage {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--accent);
  }
  .raw-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .raw-close {
    margin-left: auto;
    background: none;
    border: none;
    border-radius: 0;
    font-size: var(--fs-body);
    line-height: 1;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
  }
  .raw-close:hover {
    color: var(--accent);
  }
  .raw-body {
    overflow: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
  }
  .raw-sec {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-ghost);
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line-hair);
  }
  .file-table {
    width: 100%;
    border-collapse: collapse;
    /* Fixed + a colgroup: an auto table with 400 paths in it reflows on every
       scroll and the numeric columns drift. */
    table-layout: fixed;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .file-table td {
    padding: 5px 8px 5px 0;
    border-bottom: 1px solid var(--line-hair);
    vertical-align: top;
  }
  .f-path {
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .file-table .ins,
  .file-table .del {
    text-align: right;
  }
  .f-status {
    color: var(--text-ghost);
    text-align: right;
  }
</style>
