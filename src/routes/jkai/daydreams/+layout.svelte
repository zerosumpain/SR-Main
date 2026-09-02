<script lang="ts">
  // The daydream hub's chrome, worn by every room.
  //
  // Eleven rooms, eleven routes. This layout is the cover, the rail and the
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
  import type { Snippet } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import DaydreamShell from '$lib/components/jkai/daydream/hub/DaydreamShell.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import { HUB_BASE, hubTabs, isRoom } from '$lib/daydream/hub';
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
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set_enabled', enabled: !data.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await invalidateAll();
    } catch (err) {
      console.error('[daydream] toggle failed:', err);
    } finally {
      togglingEnabled = false;
    }
  }

  function ago(iso: string | null): string {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
  }
  function pct(n: number | null | undefined): string {
    return n == null ? '—' : `${Math.round(n * 100)}%`;
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
  .ds-vocab :global(.band) {
    padding: clamp(28px, 3.4vw, 52px) clamp(18px, 3vw, 44px);
    border-top: 1px solid var(--line-hair);
    scroll-margin-top: 60px;
  }
  .ds-vocab :global(.band.sunken) {
    background: var(--bg-section);
  }
  .ds-vocab :global(.band.flush) {
    padding-top: 0;
    border-top: 0;
  }
  .ds-vocab :global(.inner) {
    max-width: 1500px;
    margin: 0 auto;
    min-width: 0;
  }

  /* ——— type ——— */
  .ds-vocab :global(.lede) {
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 90ch;
    text-wrap: pretty;
    margin: 0 0 20px;
  }
  .ds-vocab :global(.note) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.65;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    max-width: 96ch;
    margin: 12px 0 0;
  }
  .ds-vocab :global(.note.warn) {
    color: var(--warn);
  }
  .ds-vocab :global(.note.good) {
    color: var(--good);
  }
  .ds-vocab :global(.err) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.05em;
    color: var(--error);
    margin: 12px 0 0;
  }
  .ds-vocab :global(.field-label) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 10px;
  }
  .ds-vocab :global(.dim) {
    color: var(--text-ghost);
  }
  .ds-vocab :global(.link) {
    color: var(--accent);
    text-decoration: none;
  }
  .ds-vocab :global(.link:hover) {
    text-decoration: underline;
  }
  /* The family mark — a category is a WORD in the label face, not a colour. */
  .ds-vocab :global(.mark) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--tone, var(--accent-ink));
    white-space: nowrap;
  }

  /* ——— controls ——— */
  .ds-vocab :global(.controls) {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 0 20px;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
    margin-bottom: 22px;
  }
  .ds-vocab :global(.cta),
  .ds-vocab :global(.btn) {
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
  .ds-vocab :global(.cta) {
    color: var(--bg);
    background: var(--accent);
    border: 1px solid var(--accent);
  }
  .ds-vocab :global(.cta:hover:not(:disabled)) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .ds-vocab :global(.btn) {
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--line-strong);
  }
  .ds-vocab :global(.btn:hover:not(:disabled)) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .ds-vocab :global(.btn.danger:hover:not(:disabled)) {
    border-color: var(--error);
    color: var(--error);
  }
  .ds-vocab :global(.btn.picked) {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .ds-vocab :global(.btn.danger.picked) {
    background: var(--error);
    border-color: var(--error);
    color: var(--bg);
  }
  .ds-vocab :global(.btn.sm),
  .ds-vocab :global(.cta.sm) {
    padding: 5px 10px;
  }
  .ds-vocab :global(.cta:disabled),
  .ds-vocab :global(.btn:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ds-vocab :global(.cta:focus-visible),
  .ds-vocab :global(.btn:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .ds-vocab :global(.text-input) {
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
  .ds-vocab :global(.text-input:focus) {
    outline: none;
    border-color: var(--accent);
  }
  .ds-vocab :global(.text-input.area) {
    width: 100%;
    resize: vertical;
    line-height: 1.5;
  }
  .ds-vocab :global(.text-input.select) {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    text-transform: lowercase;
  }
  .ds-vocab :global(.actions) {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* ——— layout ——— */
  .ds-vocab :global(.grid) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 14px;
  }
  .ds-vocab :global(.stack) {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .ds-vocab :global(.stack.tight) {
    gap: 8px;
  }
  .ds-vocab :global(.section-gap) {
    margin-top: clamp(24px, 3vw, 40px);
  }
  .ds-vocab :global(.anchored) {
    scroll-margin-top: 72px;
  }

  /* ——— cards: one shape, six tones ——— */
  .ds-vocab :global(.card) {
    --tone: var(--accent-ink);
    position: relative;
    background: var(--surface-card);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--tone);
    border-radius: 0;
    padding: 18px 20px;
    min-width: 0;
  }
  .ds-vocab :global(.card.t-urgent) {
    --tone: var(--error);
    background: var(--error-bg);
  }
  .ds-vocab :global(.card.t-action) {
    --tone: var(--accent);
    background: var(--accent-tint-04);
  }
  .ds-vocab :global(.card.t-watch) {
    --tone: var(--warn);
  }
  .ds-vocab :global(.card.t-good) {
    --tone: var(--good);
  }
  .ds-vocab :global(.card.t-steady) {
    --tone: var(--accent-ink);
  }
  .ds-vocab :global(.card.t-quiet) {
    --tone: var(--text-ghost);
    background: transparent;
  }
  .ds-vocab :global(.card.open) {
    border-color: var(--tone);
  }
  .ds-vocab :global(.card.ruled) {
    opacity: 0.72;
  }
  .ds-vocab :global(.card.row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .ds-vocab :global(.card-kicker) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--tone, var(--text-muted));
    margin: 0 0 10px;
  }
  .ds-vocab :global(.card-title) {
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
  .ds-vocab :global(.card-title:hover) {
    color: var(--accent);
  }
  .ds-vocab :global(.card-title:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .ds-vocab :global(.card-title.as-text) {
    cursor: default;
  }
  .ds-vocab :global(.card-title.as-text:hover) {
    color: var(--text-primary);
  }
  .ds-vocab :global(.card-figure) {
    font-family: var(--font-display);
    font-size: 34px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    color: var(--tone);
    margin: 0 0 10px;
    overflow-wrap: anywhere;
  }
  .ds-vocab :global(.card-figure.sm) {
    font-size: 22px;
  }
  .ds-vocab :global(.card-body) {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 0;
  }
  .ds-vocab :global(.card-body.lead) {
    color: var(--text-primary);
  }
  .ds-vocab :global(.card-body.sm) {
    font-size: var(--fs-nav);
  }
  .ds-vocab :global(.card-body + .card-body) {
    margin-top: 10px;
  }
  .ds-vocab :global(.card-body.clamp) {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .ds-vocab :global(.card-meta) {
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
  .ds-vocab :global(.meta-item.stamp) {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text-muted);
  }
  .ds-vocab :global(.meta-item.warn) {
    color: var(--warn);
  }
  .ds-vocab :global(.meta-item.good) {
    color: var(--good);
  }
  .ds-vocab :global(.card-actions) {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 16px;
  }

  /* ——— pills and tags ——— */
  .ds-vocab :global(.pill) {
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
  .ds-vocab :global(.pill.t-urgent) {
    color: var(--error);
  }
  .ds-vocab :global(.pill.t-action) {
    color: var(--accent);
    background: var(--accent-tint-08);
  }
  .ds-vocab :global(.pill.t-watch) {
    color: var(--warn);
  }
  .ds-vocab :global(.pill.t-good) {
    color: var(--good);
  }
  .ds-vocab :global(.pill.t-steady) {
    color: var(--accent-ink);
  }
  .ds-vocab :global(.pill.t-quiet) {
    color: var(--text-ghost);
  }
  .ds-vocab :global(.tag) {
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
  .ds-vocab :global(.tag.accent),
  .ds-vocab :global(.tag.t-action) {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .ds-vocab :global(.tag.t-watch) {
    border-color: var(--warn-border);
    color: var(--warn);
  }
  .ds-vocab :global(.tag.t-good) {
    border-color: var(--good);
    color: var(--good);
  }
  .ds-vocab :global(.tag.t-urgent) {
    border-color: var(--error);
    color: var(--error);
  }
  .ds-vocab :global(.tag.t-steady) {
    border-color: var(--accent-ink-tint-35);
    color: var(--accent-ink);
  }
  .ds-vocab :global(.q-ext) {
    margin-left: 4px;
    opacity: 0.7;
  }

  /* ——— tables ——— */
  .ds-vocab :global(.tbl-wrap) {
    overflow-x: auto;
  }
  .ds-vocab :global(.tbl) {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .ds-vocab :global(.tbl thead tr) {
    background: var(--card-bg);
    border-bottom: 2px solid rgba(26, 16, 8, 0.2);
  }
  .ds-vocab :global(.tbl th) {
    padding: 11px 12px;
    text-align: left;
    white-space: nowrap;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ds-vocab :global(.tbl tbody tr) {
    border-bottom: 1px solid var(--line-hair);
    transition: background-color var(--t-fast) var(--ease-out);
  }
  .ds-vocab :global(.tbl tbody tr:last-child) {
    border-bottom: none;
  }
  .ds-vocab :global(.tbl tbody tr:hover) {
    background: rgba(26, 16, 8, 0.05);
  }
  .ds-vocab :global(.tbl tbody tr.dim) {
    color: var(--text-ghost);
  }
  .ds-vocab :global(.tbl td) {
    padding: 10px 12px;
    vertical-align: middle;
    color: var(--text-secondary);
  }
  .ds-vocab :global(.tbl.compact th),
  .ds-vocab :global(.tbl.compact td) {
    padding: 7px 10px;
  }
  .ds-vocab :global(.tbl th.right),
  .ds-vocab :global(.tbl td.right) {
    text-align: right;
    width: 1%;
    white-space: nowrap;
  }
  .ds-vocab :global(.tbl td.num) {
    font-family: var(--font-code);
    font-variant-numeric: tabular-nums;
  }
  .ds-vocab :global(.tbl td.nowrap) {
    white-space: nowrap;
  }
  .ds-vocab :global(.tbl td.cell-wrap) {
    min-width: 22ch;
  }
  .ds-vocab :global(.tbl td.bad) {
    color: var(--error);
    font-weight: 700;
  }
  .ds-vocab :global(.cell-lead) {
    color: var(--text-primary);
  }
  .ds-vocab :global(.cell-title) {
    display: block;
    font-family: var(--font-display);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  /* ——— the detail, in a drill ——— */
  .ds-vocab :global(.detail) {
    border-top: 1px solid var(--line-hair);
    margin-top: 16px;
    padding-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .ds-vocab :global(.detail-block) {
    min-width: 0;
  }
  .ds-vocab :global(.detail-line) {
    font-size: var(--fs-nav);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 92ch;
    text-wrap: pretty;
    margin: 0 0 8px;
  }
  .ds-vocab :global(.detail-line.said) {
    color: var(--text-primary);
    border-left: 2px solid var(--accent-tint-35);
    padding-left: 12px;
  }
</style>
