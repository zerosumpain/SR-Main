<script lang="ts" module>
  import type { RankedSource } from '$lib/deepdive/media-type';
  export type { RankedSource };
</script>

<script lang="ts">
  /**
   * The sources, ordered by what they were worth and flagged by what they are.
   *
   * The old list was an `<ol>` sorted by credibility score. On a real run that
   * put six government pages which produced NOTHING above the two trade-press
   * articles that produced all 32 facts in the report, and it showed a Harvard
   * PDF study, a YouTube video and a LinkedIn profile in identical styling. A
   * reader could not tell which sources the answer actually rested on, nor what
   * kind of material any of them were.
   *
   * Three changes, all of them about making the list answerable:
   *
   *  - **Media flag** — what the thing IS (paper, dataset, video, profile),
   *    separate from `credibility_type`, which is about the publisher. See
   *    `$lib/deepdive/media-type` for why those are different questions.
   *  - **Key material first** — anything that fed the report or is substantial
   *    by form sits in the top band, with the reason stated. A badge with no
   *    reason is a decoration.
   *  - **Contribution as a bar** — facts-per-source, inline. This is a table
   *    with a magnitude column rather than a separate chart: the shape (two
   *    sources carrying everything) is visible without a second panel.
   *
   * And one action: **keep it**. A run identifies the papers and reports that
   * carried the answer and then stores nothing but a URL to each of them, which
   * is worth very little once the page moves or the PDF goes behind a login.
   * Saving to /drive puts the bytes somewhere they get embedded into the @files
   * index and fed to entity resolution — see `$lib/deepdive/to-drive`.
   */
  import { credibilityBadge } from '$lib/deepdive/display';

  let {
    sources = [],
    filterKind = null,
    onClearFilter,
    sessionId,
    savedSourceIds = [],
    driveFolder = null,
  }: {
    sources: RankedSource[];
    /** Media kind to narrow to, driven by the source-mix chart. */
    filterKind?: string | null;
    onClearFilter?: () => void;
    /** Absent on the shared/public view, which has no business writing files. */
    sessionId?: string;
    /** Sources already copied into /drive, from the loader. */
    savedSourceIds?: string[];
    /** Where they land, so the panel can link to it. */
    driveFolder?: string | null;
  } = $props();

  let showAll = $state(false);
  const COLLAPSED = 12;

  let saved = $state(new Set(savedSourceIds));
  let saving = $state(new Set<string>());
  let bulkBusy = $state(false);
  let saveNote = $state<string | null>(null);
  let saveError = $state<string | null>(null);

  const canSave = $derived(!!sessionId);
  const unsavedKey = $derived(sources.filter((s) => s.keyMaterial && !saved.has(s.id)));

  interface SaveResult {
    sourceId: string;
    status: 'saved' | 'already-there' | 'failed';
    reason?: string;
  }

  async function save(ids: string[]) {
    if (!sessionId || !ids.length) return;
    saveError = null;
    saveNote = null;
    // A fresh Set each time: mutating one in place does not re-render under
    // runes, because the assignment is what the template is tracking.
    saving = new Set([...saving, ...ids]);
    try {
      const res = await fetch(`/api/research/${sessionId}/to-drive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceIds: ids }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: SaveResult[];
        saved?: number;
        alreadyThere?: number;
        failed?: number;
      };
      if (!res.ok) {
        saveError = body.error ?? `Could not save to Drive (${res.status}).`;
        return;
      }
      const next = new Set(saved);
      for (const r of body.results ?? []) {
        if (r.status === 'saved' || r.status === 'already-there') next.add(r.sourceId);
      }
      saved = next;

      const failures = (body.results ?? []).filter((r) => r.status === 'failed');
      const parts: string[] = [];
      if (body.saved) parts.push(`${body.saved} saved`);
      if (body.alreadyThere) parts.push(`${body.alreadyThere} already there`);
      if (failures.length) {
        // Name the reason rather than a count — "3 failed" tells you nothing you
        // can act on, and the usual causes (paywall, dead link) are different
        // problems with different answers.
        parts.push(
          `${failures.length} could not be fetched (${[...new Set(failures.map((f) => f.reason ?? 'unknown'))]
            .slice(0, 2)
            .join('; ')})`,
        );
      }
      saveNote = parts.join(' · ') || 'Nothing to do.';
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Could not save to Drive.';
    } finally {
      saving = new Set([...saving].filter((id) => !ids.includes(id)));
      bulkBusy = false;
    }
  }

  function saveAllKey() {
    bulkBusy = true;
    void save(unsavedKey.map((s) => s.id));
  }

  const filtered = $derived(
    filterKind ? sources.filter((s) => s.media.kind === filterKind) : sources,
  );
  const key = $derived(filtered.filter((s) => s.keyMaterial));
  const rest = $derived(filtered.filter((s) => !s.keyMaterial));
  const visibleRest = $derived(showAll ? rest : rest.slice(0, COLLAPSED));

  const maxFacts = $derived(Math.max(1, ...sources.map((s) => s.factCount)));

  function label(s: RankedSource): string {
    return s.title?.trim() || s.domain?.trim() || s.url;
  }
</script>

<section class="nm-sec" id="sources">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Sources</span>
    <span class="nm-sec-meta">
      {#if filterKind}
        {filtered.length} {filtered.length === 1 ? 'source' : 'sources'} tagged {filterKind}
      {:else}
        {key.length} key of {sources.length}
      {/if}
    </span>
    {#if filterKind && onClearFilter}
      <button type="button" class="clear" onclick={onClearFilter}>Clear filter</button>
    {/if}
    {#if canSave && unsavedKey.length}
      <button type="button" class="clear keep" disabled={bulkBusy} onclick={saveAllKey}>
        {bulkBusy ? 'Saving…' : `Keep ${unsavedKey.length} in Drive`}
      </button>
    {/if}
  </div>

  {#if canSave && (saveNote || saveError || driveFolder)}
    <p class="drive-line" class:err={!!saveError}>
      {#if saveError}
        {saveError}
      {:else if saveNote}
        {saveNote}{#if driveFolder} — <a href="/drive">{driveFolder}</a>{/if}
      {:else if driveFolder && saved.size}
        {saved.size} of these are in <a href="/drive">{driveFolder}</a>, indexed for search and entity resolution.
      {:else}
        Keeping a source copies the document itself into <code>{driveFolder}</code>, where it is indexed
        for search and entity resolution.
      {/if}
    </p>
  {/if}

  {#if filtered.length === 0}
    <p class="note">No sources.</p>
  {:else}
    {#if key.length}
      <div class="band-hd">
        <span class="sr-label-tight">Worth reading</span>
        <span class="band-why">fed the report, or substantial material</span>
      </div>
      <ul class="srcs">
        {#each key as s (s.id)}
          <li class="src key">
            <div class="flags">
              <span class="media">{s.media.label}</span>
              <span class="cred" style:color={credibilityBadge(s.credibilityType).color}>
                {credibilityBadge(s.credibilityType).label}
              </span>
            </div>
            <div class="body">
              <a href={s.url} target="_blank" rel="noopener noreferrer">{label(s)}</a>
              <div class="meta">
                <span class="domain">{s.domain ?? ''}</span>
                {#if s.reasons.length}<span class="why">{s.reasons.join(' · ')}</span>{/if}
                {#if canSave}
                  {#if saved.has(s.id)}
                    <a class="keep-link done" href="/drive">In Drive</a>
                  {:else}
                    <button
                      type="button"
                      class="keep-link"
                      disabled={saving.has(s.id)}
                      onclick={() => save([s.id])}
                    >{saving.has(s.id) ? 'Saving…' : 'Keep in Drive'}</button>
                  {/if}
                {/if}
              </div>
              {#if s.snippet}<p class="snip">{s.snippet}</p>{/if}
            </div>
            <div class="contrib" title="{s.factCount} facts extracted from this source">
              {#if s.factCount > 0}
                <span class="bar" style:width="{(s.factCount / maxFacts) * 100}%"></span>
                <span class="n">{s.factCount}</span>
              {:else}
                <span class="n none">—</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if rest.length}
      <div class="band-hd second">
        <span class="sr-label-tight">Also found</span>
        <span class="band-why">gathered, but nothing in the report rests on them</span>
      </div>
      <ul class="srcs">
        {#each visibleRest as s (s.id)}
          <li class="src">
            <div class="flags">
              <span class="media quiet">{s.media.label}</span>
            </div>
            <div class="body">
              <a href={s.url} target="_blank" rel="noopener noreferrer">{label(s)}</a>
              <div class="meta">
                <span class="domain">{s.domain ?? ''}</span>
                {#if canSave}
                  {#if saved.has(s.id)}
                    <a class="keep-link done" href="/drive">In Drive</a>
                  {:else}
                    <button
                      type="button"
                      class="keep-link"
                      disabled={saving.has(s.id)}
                      onclick={() => save([s.id])}
                    >{saving.has(s.id) ? 'Saving…' : 'Keep in Drive'}</button>
                  {/if}
                {/if}
              </div>
            </div>
            <div class="contrib"><span class="n none">—</span></div>
          </li>
        {/each}
      </ul>
      {#if rest.length > COLLAPSED}
        <button type="button" class="more" onclick={() => (showAll = !showAll)}>
          {showAll ? 'Show fewer' : `Show all ${rest.length}`}
        </button>
      {/if}
    {/if}
  {/if}
</section>

<style>
  /* .nm-sec, .nm-sec-hd, .sr-label-tight, .nm-sec-meta: $lib/styles/nm-tokens.css */
  .clear { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; background: none; border: 1px solid var(--line-strong); color: var(--text-muted); cursor: pointer; padding: 3px 8px; }
  .clear:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .clear:disabled { opacity: 0.5; cursor: default; }
  .clear.keep { border-color: var(--accent); color: var(--accent); margin-left: auto; }

  .drive-line { margin: 0 0 0.6rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); line-height: 1.5; }
  .drive-line.err { color: var(--error); }
  .drive-line a { color: var(--accent); }
  .drive-line code { font-family: var(--font-code); color: var(--text-secondary); }

  /* Row action. Sits in the meta line rather than taking a fourth column: the
     grid is already three columns at 620px and a button column would push the
     title into two words per line. */
  .keep-link {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em;
    background: none; border: none; padding: 0; cursor: pointer;
    color: var(--accent); text-decoration: none;
  }
  .keep-link:hover:not(:disabled) { text-decoration: underline; }
  .keep-link:disabled { opacity: 0.55; cursor: default; }
  .keep-link.done { color: var(--success); }

  .band-hd { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
  .band-hd.second { margin-top: 1rem; padding-top: 0.6rem; border-top: 1px solid var(--line-hair); }
  .band-why { font-size: 0.78rem; color: var(--text-ghost); font-style: italic; }

  .srcs { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .src {
    display: grid;
    grid-template-columns: 92px 1fr 64px;
    gap: 0.6rem;
    align-items: start;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--line-hair);
  }
  .src:last-child { border-bottom: none; padding-bottom: 0; }

  .flags { display: grid; gap: 2px; justify-items: start; }
  .media {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em;
    border: 1px solid var(--accent); color: var(--accent); padding: 1px 5px; white-space: nowrap;
  }
  /* The second band is context, not evidence — its flag recedes. */
  .media.quiet { border-color: var(--line-strong); color: var(--text-ghost); }
  .cred { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; }

  .body a { color: var(--text-primary); font-size: 0.92rem; line-height: 1.35; }
  .body a:hover { color: var(--accent); }
  .meta { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.15rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .why { color: var(--accent); }
  .snip { margin: 0.3rem 0 0; font-size: 0.82rem; line-height: 1.45; color: var(--text-muted); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  /* Magnitude column: one hue, and the number is always present so the bar is
     never the only thing carrying the value. */
  .contrib { position: relative; display: flex; align-items: center; justify-content: flex-end; gap: 4px; min-height: 18px; }
  .bar { position: absolute; left: 0; right: auto; height: 8px; background: var(--accent); opacity: 0.72; border-radius: 2px; }
  .n { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary); position: relative; }
  .n.none { color: var(--text-ghost); }

  .more { margin-top: 0.6rem; font-family: var(--font-mono); font-size: var(--fs-label); background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; }
  .more:hover { text-decoration: underline; }
  .note { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; }

  @media (max-width: 620px) {
    .src { grid-template-columns: 1fr 52px; }
    .flags { grid-column: 1 / -1; grid-auto-flow: column; justify-content: start; gap: 0.4rem; }
  }
</style>
