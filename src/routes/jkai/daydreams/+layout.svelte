<script lang="ts">
  // The daydream hub's chrome, worn by every room.
  //
  // Twelve rooms, twelve routes. This layout is the cover, the rail and the
  // foot; a room is whatever renders between them. The rail is a row of real
  // links, so a tab is a navigation and never a `?tab=` state change — the
  // same-route trap that killed five shipped links lives in git history now.
  //
  // It also carries the shared CSS VOCABULARY (`.ds-vocab`): band, card, pill,
  // tag, table, button. Declared once here as `:global` rules under a wrapper
  // class rather than imported from a `.css` file, because a standalone CSS
  // import from a route file breaks the vite-pwa build while svelte-check
  // passes clean. `DrillPanel` puts `ds-vocab` on its own portalled panel so
  // the vocabulary reaches it outside this wrapper.
  //
  // The wrapper class must be INSIDE the `:global()`, not in front of it.
  // `.ds-vocab :global(.btn)` scopes the ancestor — it compiles to
  // `.ds-vocab.svelte-HASH .btn`, and that hash exists only on the wrapper
  // below, so nothing portalled to <body> ever matched. Every drill was
  // therefore rendering unstyled buttons, inputs and tables (measured
  // 2026-09-06: border-width 0, padding 0 on every one of them inside
  // `DrillPanel`), which is why the epic panel had reached for the `.nm-*`
  // admin classes instead. `:global(.ds-vocab .btn)` leaves the ancestor
  // unscoped and still requires it, so nothing leaks past this hub.
  import type { Snippet } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import DaydreamShell from '$lib/components/jkai/daydream/hub/DaydreamShell.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import { HUB_BASE, hubTabs, isRoom } from '$lib/daydream/hub';
  import { ago, pct } from '$lib/daydream/format';
  import { postThought } from '$lib/daydream/feed-client';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  const counts = $derived(data.counts);
  const tabs = $derived(hubTabs(counts));
  const active = $derived.by(() => {
    const seg = page.url.pathname.slice(HUB_BASE.length + 1).split('/')[0];
    return isRoom(seg) ? seg : 'feed';
  });

  let togglingEnabled = $state(false);
  async function toggleEnabled() {
    togglingEnabled = true;
    const r = await postThought({ action: 'set_enabled', enabled: !data.enabled });
    if (!r.ok) console.error('[daydream] toggle failed:', r.error);
    else await invalidateAll();
    togglingEnabled = false;
  }


  const hasRun = $derived(counts.engine.lastDetectAt != null);
  const readout = $derived([
    { label: 'Last looked', value: hasRun ? ago(counts.engine.lastDetectAt) : 'never' },
    { label: 'Trail', value: `${counts.engine.trailSpanDays ?? 0} days` },
    { label: 'Covered 24h', value: pct(counts.engine.coverage?.last24h) },
  ]);

  const needsTotal = $derived(counts.needsRating + counts.needsNaming + counts.proposedRules);
  const healthyJobs = $derived(counts.jobs - counts.failingJobs);
  const coverTiles = $derived<DeckTile[]>([
    {
      key: 'needs',
      label: 'Undecided',
      value: String(needsTotal),
      tone: needsTotal ? 'action' : 'good',
      lit: needsTotal > 0,
      sub: `${counts.needsNaming} to name · ${counts.proposedRules} to approve · ${counts.needsRating} to rate`,
    },
    {
      key: 'noticed',
      label: 'Noticed, 7 days',
      value: String(counts.thoughts7d),
      tone: 'steady',
      sub: `${counts.thoughtsAll} all time · ${counts.held} held back`,
    },
    {
      key: 'watches',
      label: 'Active watches',
      value: String(counts.activeWatches),
      tone: counts.activeWatches ? 'steady' : 'quiet',
      sub: counts.activeWatches ? 'checked on their own schedules' : 'nothing being watched',
    },
    {
      key: 'places',
      label: 'Places named',
      value: String(counts.namedPlaces),
      suffix: `/${counts.places}`,
      tone: counts.unnamedPlaces ? 'watch' : 'good',
      sub: `${counts.unnamedPlaces} still unnamed`,
    },
    {
      key: 'jobs',
      label: 'Jobs healthy',
      value: String(healthyJobs),
      suffix: `/${counts.jobs}`,
      tone: counts.failingJobs ? 'urgent' : 'good',
      sub: counts.failingJobs ? `${counts.failingJobs} failing or paused` : 'every activity on schedule',
    },
  ]);
</script>

<svelte:head><title>Daydreams — JKAI</title></svelte:head>

<DaydreamShell
  path="/jkai/daydreams"
  kicker="JKAI · Background intelligence"
  title={['Notice quietly,', 'act with evidence']}
  standfirst="Briefings, deliberate watches, household patterns and the system’s own learning share one evidence trail. It stays quiet until a crossing is worth it, and every claim shows what it rests on."
  {readout}
  live={data.enabled}
  liveBusy={togglingEnabled}
  ontoggleLive={toggleEnabled}
  {tabs}
  {active}
  footer={[
    'strangeramblings.com/jkai/daydreams',
    'Owner-gated · nothing here leaves the house',
    `Threshold ${counts.threshold.value} · ${counts.threshold.feedbackCount} response${counts.threshold.feedbackCount === 1 ? '' : 's'}`,
  ]}
>
  {#snippet masthead()}
    <StatDeck dark tiles={coverTiles} min={210} />
  {/snippet}

  <div class="ds-vocab">
    {#if data.hubError}
      <section class="band">
        <div class="inner">
          <div class="card t-urgent">
            <p class="card-kicker">The counts did not load</p>
            <p class="card-body">{data.hubError}</p>
            <p class="note">
              Every badge and tile above is therefore a zero for a reason that has nothing to
              do with what the engine has been noticing. The room below loads on its own.
            </p>
          </div>
        </div>
      </section>
    {/if}

    {#if !data.enabled}
      <section class="band">
        <div class="inner">
          <div class="card t-watch">
            <p class="card-kicker">Paused</p>
            <p class="card-body">
              Nothing is being observed and nothing is being noticed. The control in the masthead
              resumes it; everything below is the state it was in when it stopped.
            </p>
          </div>
        </div>
      </section>
    {/if}

    {@render children()}
  </div>
</DaydreamShell>

<style>
  /* ══ The shared vocabulary ═══════════════════════════════════════════════
     Radii 0 (pills 100 only), no shadows, no springs, 12px mono floor. Colour
     is PRIORITY, not category: every card, pill and tag reads its hue from one
     `--tone` set by the `t-*` class the room put on it, and those classes come
     from `$lib/daydream/priority.ts`. Category is a MARK (`.mark`), never a
     colour. */

  /* ——— bands ——— */
  :global(.ds-vocab .band) {
    padding: clamp(28px, 3.4vw, 52px) clamp(18px, 3vw, 44px);
    border-top: 1px solid var(--line-hair);
    scroll-margin-top: 60px;
  }
  :global(.ds-vocab .band.sunken) {
    background: var(--bg-section);
  }
  :global(.ds-vocab .band.flush) {
    padding-top: 0;
    border-top: 0;
  }
  /* A band the page turns over to. Ink is how this hub says "this is the
     system talking about itself" — the cover and the foot already use it, and
     a room that needs the same weight inside its own flow had been reaching
     for a card on cream, which reads as one more exhibit rather than a change
     of voice. Cream text is `--bg`, the accent moves to its on-dark partner
     and `--line-hair` is invisible here, so hairlines are cream at 14%. */
  :global(.ds-vocab .band.ink) {
    background: var(--text-primary);
    color: var(--bg);
    border-top: 0;
  }
  :global(.ds-vocab .inner) {
    max-width: 1500px;
    margin: 0 auto;
    min-width: 0;
  }

  /* ——— type ——— */
  :global(.ds-vocab .lede) {
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 90ch;
    text-wrap: pretty;
    margin: 0 0 20px;
  }
  :global(.ds-vocab .note) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.65;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    max-width: 96ch;
    margin: 12px 0 0;
  }
  :global(.ds-vocab .note.warn) {
    color: var(--warn);
  }
  :global(.ds-vocab .note.good) {
    color: var(--good);
  }
  :global(.ds-vocab .err) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.05em;
    color: var(--error);
    margin: 12px 0 0;
  }
  :global(.ds-vocab .field-label) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 10px;
  }
  :global(.ds-vocab .dim) {
    color: var(--text-ghost);
  }
  :global(.ds-vocab .link) {
    color: var(--accent);
    text-decoration: none;
  }
  :global(.ds-vocab .link:hover) {
    text-decoration: underline;
  }
  /* The family mark — a category is a WORD in the label face, not a colour. */
  :global(.ds-vocab .mark) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--tone, var(--accent-ink));
    white-space: nowrap;
  }

  /* ——— controls ——— */
  :global(.ds-vocab .controls) {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 0 20px;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
    margin-bottom: 22px;
  }
  :global(.ds-vocab .cta),
  :global(.ds-vocab .btn) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 9px 16px;
    border-radius: 0;
    cursor: pointer;
    white-space: nowrap;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition:
      background-color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out),
      color var(--t-fast) var(--ease-out);
  }
  :global(.ds-vocab .cta) {
    color: var(--bg);
    background: var(--accent);
    border: 1px solid var(--accent);
  }
  :global(.ds-vocab .cta:hover:not(:disabled)) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  :global(.ds-vocab .btn) {
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--line-strong);
  }
  :global(.ds-vocab .btn:hover:not(:disabled)) {
    border-color: var(--accent);
    color: var(--accent);
  }
  :global(.ds-vocab .btn.danger:hover:not(:disabled)) {
    border-color: var(--error);
    color: var(--error);
  }
  :global(.ds-vocab .btn.picked) {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  :global(.ds-vocab .btn.danger.picked) {
    background: var(--error);
    border-color: var(--error);
    color: var(--bg);
  }
  :global(.ds-vocab .btn.sm),
  :global(.ds-vocab .cta.sm) {
    padding: 5px 10px;
  }
  :global(.ds-vocab .cta:disabled),
  :global(.ds-vocab .btn:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  :global(.ds-vocab .cta:focus-visible),
  :global(.ds-vocab .btn:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  :global(.ds-vocab .text-input) {
    font-family: var(--font-body);
    /* 16px, not smaller: mobile Safari force-zooms the viewport on a sub-16px
       field and strands the rest of the form off-screen. */
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 9px 12px;
    min-width: 0;
    flex: 1 1 220px;
  }
  :global(.ds-vocab .text-input:focus) {
    outline: none;
    border-color: var(--accent);
  }
  :global(.ds-vocab .text-input.area) {
    width: 100%;
    resize: vertical;
    line-height: 1.5;
  }
  :global(.ds-vocab .text-input.select) {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    text-transform: lowercase;
  }
  :global(.ds-vocab .actions) {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* ——— layout ——— */
  :global(.ds-vocab .grid) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 14px;
  }
  :global(.ds-vocab .stack) {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  :global(.ds-vocab .stack.tight) {
    gap: 8px;
  }
  :global(.ds-vocab .section-gap) {
    margin-top: clamp(24px, 3vw, 40px);
  }
  :global(.ds-vocab .anchored) {
    scroll-margin-top: 72px;
  }

  /* ——— cards: one shape, six tones ——— */
  :global(.ds-vocab .card) {
    --tone: var(--accent-ink);
    position: relative;
    background: var(--surface-card);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--tone);
    border-radius: 0;
    padding: 18px 20px;
    min-width: 0;
  }
  :global(.ds-vocab .card.t-urgent) {
    --tone: var(--error);
    background: var(--error-bg);
  }
  :global(.ds-vocab .card.t-action) {
    --tone: var(--accent);
    background: var(--accent-tint-04);
  }
  :global(.ds-vocab .card.t-watch) {
    --tone: var(--warn);
  }
  :global(.ds-vocab .card.t-good) {
    --tone: var(--good);
  }
  :global(.ds-vocab .card.t-steady) {
    --tone: var(--accent-ink);
  }
  :global(.ds-vocab .card.t-quiet) {
    --tone: var(--text-ghost);
    background: transparent;
  }
  :global(.ds-vocab .card.open) {
    border-color: var(--tone);
  }
  :global(.ds-vocab .card.ruled) {
    opacity: 0.72;
  }
  :global(.ds-vocab .card.row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  :global(.ds-vocab .card-kicker) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--tone, var(--text-muted));
    margin: 0 0 10px;
  }
  :global(.ds-vocab .card-title) {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    line-height: 1.15;
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
    transition: color var(--t-fast) var(--ease-out);
  }
  :global(.ds-vocab .card-title:hover) {
    color: var(--accent);
  }
  :global(.ds-vocab .card-title:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  :global(.ds-vocab .card-title.as-text) {
    cursor: default;
  }
  :global(.ds-vocab .card-title.as-text:hover) {
    color: var(--text-primary);
  }
  :global(.ds-vocab .card-figure) {
    font-family: var(--font-display);
    font-size: 34px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    color: var(--tone);
    margin: 0 0 10px;
    overflow-wrap: anywhere;
  }
  :global(.ds-vocab .card-figure.sm) {
    font-size: 22px;
  }
  :global(.ds-vocab .card-body) {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 0;
  }
  :global(.ds-vocab .card-body.lead) {
    color: var(--text-primary);
  }
  :global(.ds-vocab .card-body.sm) {
    font-size: var(--fs-nav);
  }
  :global(.ds-vocab .card-body + .card-body) {
    margin-top: 10px;
  }
  :global(.ds-vocab .card-body.clamp) {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  :global(.ds-vocab .card-meta) {
    display: flex;
    align-items: center;
    gap: 8px 14px;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-top: 14px;
  }
  :global(.ds-vocab .meta-item.stamp) {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text-muted);
  }
  :global(.ds-vocab .meta-item.warn) {
    color: var(--warn);
  }
  :global(.ds-vocab .meta-item.good) {
    color: var(--good);
  }
  :global(.ds-vocab .card-actions) {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 16px;
  }

  /* ——— pills and tags ——— */
  :global(.ds-vocab .pill) {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 3px 10px;
    border: 1px solid currentcolor;
    border-radius: var(--radius-pill);
    color: var(--text-muted);
  }
  :global(.ds-vocab .pill.t-urgent) {
    color: var(--error);
  }
  :global(.ds-vocab .pill.t-action) {
    color: var(--accent);
    background: var(--accent-tint-08);
  }
  :global(.ds-vocab .pill.t-watch) {
    color: var(--warn);
  }
  :global(.ds-vocab .pill.t-good) {
    color: var(--good);
  }
  :global(.ds-vocab .pill.t-steady) {
    color: var(--accent-ink);
  }
  :global(.ds-vocab .pill.t-quiet) {
    color: var(--text-ghost);
  }
  :global(.ds-vocab .tag) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 8px;
    border: 1px solid var(--card-border);
    border-radius: 0;
    color: var(--text-muted);
    white-space: nowrap;
    text-decoration: none;
  }
  :global(.ds-vocab .tag.accent),
  :global(.ds-vocab .tag.t-action) {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  :global(.ds-vocab .tag.t-watch) {
    border-color: var(--warn-border);
    color: var(--warn);
  }
  :global(.ds-vocab .tag.t-good) {
    border-color: var(--good);
    color: var(--good);
  }
  :global(.ds-vocab .tag.t-urgent) {
    border-color: var(--error);
    color: var(--error);
  }
  :global(.ds-vocab .tag.t-steady) {
    border-color: var(--accent-ink-tint-35);
    color: var(--accent-ink);
  }
  :global(.ds-vocab .q-ext) {
    margin-left: 4px;
    opacity: 0.7;
  }

  /* ——— tables ——— */
  :global(.ds-vocab .tbl-wrap) {
    overflow-x: auto;
  }
  :global(.ds-vocab .tbl) {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  :global(.ds-vocab .tbl thead tr) {
    background: var(--card-bg);
    border-bottom: 2px solid rgba(26, 16, 8, 0.2);
  }
  :global(.ds-vocab .tbl th) {
    padding: 11px 12px;
    text-align: left;
    white-space: nowrap;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  :global(.ds-vocab .tbl tbody tr) {
    border-bottom: 1px solid var(--line-hair);
    transition: background-color var(--t-fast) var(--ease-out);
  }
  :global(.ds-vocab .tbl tbody tr:last-child) {
    border-bottom: none;
  }
  :global(.ds-vocab .tbl tbody tr:hover) {
    background: rgba(26, 16, 8, 0.05);
  }
  :global(.ds-vocab .tbl tbody tr.dim) {
    color: var(--text-ghost);
  }
  :global(.ds-vocab .tbl td) {
    padding: 10px 12px;
    vertical-align: middle;
    color: var(--text-secondary);
  }
  :global(.ds-vocab .tbl.compact th),
  :global(.ds-vocab .tbl.compact td) {
    padding: 7px 10px;
  }
  :global(.ds-vocab .tbl th.right),
  :global(.ds-vocab .tbl td.right) {
    text-align: right;
    width: 1%;
    white-space: nowrap;
  }
  :global(.ds-vocab .tbl td.num) {
    font-family: var(--font-code);
    font-variant-numeric: tabular-nums;
  }
  :global(.ds-vocab .tbl td.nowrap) {
    white-space: nowrap;
  }
  :global(.ds-vocab .tbl td.cell-wrap) {
    min-width: 22ch;
  }
  :global(.ds-vocab .tbl td.bad) {
    color: var(--error);
    font-weight: 700;
  }
  :global(.ds-vocab .cell-lead) {
    color: var(--text-primary);
  }
  :global(.ds-vocab .cell-title) {
    display: block;
    font-family: var(--font-display);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  /* ——— the detail, in a drill ——— */
  :global(.ds-vocab .detail) {
    border-top: 1px solid var(--line-hair);
    margin-top: 16px;
    padding-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  :global(.ds-vocab .detail-block) {
    min-width: 0;
  }
  :global(.ds-vocab .detail-line) {
    font-size: var(--fs-nav);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 92ch;
    text-wrap: pretty;
    margin: 0 0 8px;
  }
  :global(.ds-vocab .detail-line.said) {
    color: var(--text-primary);
    border-left: 2px solid var(--accent-tint-35);
    padding-left: 12px;
  }
</style>
