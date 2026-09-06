<script lang="ts">
  // Projects — the index of everything built on this site.
  //
  // Wears the /health editorial system, the same way /research, /news and
  // /drive do: `HealthShell` with `unifiedNav`, an ink cover band carrying the
  // count deck, then paper sections opened by `SectionHead`.
  //
  // Two sections, and the split is the one the page's own standfirst already
  // made: what was built by hand, and what an agent built from a single
  // prompt. The fifteen hand-built cards moved out to `./cards.ts` — they were
  // fifteen copies of one 37-line block, each with its own inline font sizes,
  // which is exactly how a page drifts out of the design system one card at a
  // time. Both kinds now render through ONE snippet, so they cannot diverge.
  import type { PageData } from './$types';
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import SectionHead from '$lib/components/health/hub/SectionHead.svelte';
  import ShareModal from './ShareModal.svelte';
  import { PROJECT_CARDS, type ProjectCard } from './cards';
  import { resolveProjectCard } from '$lib/jkai/project-card';
  import type { Snippet } from 'svelte';

  let { data }: { data: PageData } = $props();
  let projects = $state(data.projects);
  let removing = $state<string | null>(null);
  // The project whose secure-share panel is open (owner-only).
  let shareModal = $state<{ key: string; href: string; title: string } | null>(null);

  // Per-project public/private overlay. Seeded from the server; toggles update
  // it optimistically. A missing key means public.
  let vis = $state<Record<string, boolean>>({ ...(data.visibility ?? {}) });
  let toggling = $state<string | null>(null);

  const isPub = (key: string) => vis[key] ?? true;
  const showCard = (key: string) => data.authenticated || isPub(key);

  const shownCards = $derived(PROJECT_CARDS.filter((c) => showCard(c.key)));
  const studyCount = $derived(shownCards.filter((c) => /^field study/i.test(c.kind)).length);

  async function toggleVisibility(key: string) {
    const next = !isPub(key);
    toggling = key;
    vis = { ...vis, [key]: next }; // optimistic
    try {
      const res = await fetch('/api/projects/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, isPublic: next }),
      });
      if (!res.ok) vis = { ...vis, [key]: !next }; // revert on failure
    } catch (err) {
      console.error('Failed to toggle visibility:', err);
      vis = { ...vis, [key]: !next };
    } finally {
      toggling = null;
    }
  }

  function formatDate(d: string | Date) {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  /**
   * An AI-built project, in the same shape as a hand-written card. This is the
   * join: `resolveProjectCard` already answers heading/blurb/tag, so the only
   * thing left is to name the three fields the manifest adds.
   */
  function agentCard(project: PageData['projects'][number]): ProjectCard {
    const meta = resolveProjectCard(project);
    return {
      key: project.slug!,
      href: `/projects/${project.slug}/`,
      label: `View ${project.title ?? 'project'}`,
      kind: 'AI Built',
      tag: meta.tag || formatDate(project.createdAt),
      title: meta.heading,
      blurb: meta.blurb,
      chips: `${project.iterationsCompleted} iterations`,
    };
  }

  // Two kinds of card, two meanings of "remove". An app build was COPIED to
  // /projects, so removing it deletes those files. A change request's page
  // lives in the repo and is deployed — there is nothing to delete, and only
  // the card is withdrawn. Deleting the route is a code change, not a button.
  async function removeProject(buildId: string, slug: string, source: 'repo' | 'build') {
    const question =
      source === 'repo'
        ? `Remove the card for "${slug}"? The page stays in the repo and stays deployed — this only takes it off this index.`
        : `Remove published project "${slug}"? This deletes the public files but keeps the build.`;
    if (!confirm(question)) return;
    removing = buildId;
    try {
      const res = await fetch(
        source === 'repo'
          ? `/api/jkai/builds/${buildId}/project-card`
          : `/api/jkai/builds/${buildId}/unpublish`,
        { method: source === 'repo' ? 'DELETE' : 'POST' },
      );
      if (res.ok) {
        projects = projects.filter((p) => p.id !== buildId);
      }
    } catch (err) {
      console.error('Failed to remove project:', err);
    } finally {
      removing = null;
    }
  }
</script>

<svelte:head>
  <title>Projects — Strange Ramblings</title>
  <meta name="description" content="Things I've built — interactive field studies, games, and data tools. Some by hand, some developed autonomously by AI." />
  <meta property="og:title" content="Projects — Strange Ramblings" />
  <meta property="og:description" content="Things I've built — interactive field studies, games, and data tools. Some by hand, some developed autonomously by AI." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/projects" />
</svelte:head>

{#snippet visToggle(key: string, href: string, title: string)}
  {#if data.authenticated}
    <span class="owner-controls">
      {#if !isPub(key)}<span class="chip private">Private</span>{/if}
      <button
        class="ctl"
        onclick={() => (shareModal = { key, href, title })}
        title="Create a secure share link — opens this project for a recipient even while private"
      >
        Share
      </button>
      <button
        class="ctl"
        onclick={() => toggleVisibility(key)}
        disabled={toggling === key}
        title={isPub(key)
          ? 'Visible to the public — click to make private'
          : 'Hidden from the public — click to make public'}
      >
        {toggling === key ? '…' : isPub(key) ? 'Public' : 'Private'}
      </button>
    </span>
  {/if}
{/snippet}

<!-- One card, both kinds. `extra` is the AI-built card's remove button; the
     hand-built cards pass nothing. -->
{#snippet card(c: ProjectCard, extra?: Snippet)}
  <li class="pc">
    <a class="pc-hit" href={c.href} aria-label={c.label}></a>
    <div class="pc-eyebrow">
      <span class="pc-kind">{c.kind}</span>
      <span class="pc-tag">{c.tag}</span>
    </div>
    <h3 class="pc-title">{c.title}</h3>
    <p class="pc-blurb">{c.blurb}</p>
    <div class="pc-foot">
      <span class="chip">{c.chips}</span>
      {@render visToggle(c.key, c.href, c.title)}
      {#if extra}{@render extra()}{/if}
    </div>
  </li>
{/snippet}

<HealthShell
  path="/projects"
  unifiedNav
  footer={[
    'strangeramblings.com/projects · the workbench',
    `${shownCards.length + projects.length} projects · ${studyCount} field studies`,
    'some by hand, some by an agent',
  ]}
>
  <section class="lede">
    <div class="lede-inner">
      <div class="lede-copy">
        <p class="eyebrow">Field studies · tools · games</p>
        <h1>THINGS I'VE BUILT.<br /><span>SOME OF THEM WORK.</span></h1>
        <p class="standfirst">
          Interactive field studies, strategy games and data tools, several of them digging into how
          government and education data fits together. Some made by hand, some built autonomously by
          an AI agent from a single prompt — those carry an "AI Built" mark.
        </p>
      </div>

      <dl class="bench-summary" aria-label="Projects summary">
        <div>
          <dt>On the bench</dt>
          <dd>{String(shownCards.length + projects.length).padStart(2, '0')}</dd>
          <small>Live and playable</small>
        </div>
        <div>
          <dt>Field studies</dt>
          <dd>{String(studyCount).padStart(2, '0')}</dd>
          <small>Long-form, interactive</small>
        </div>
        <div>
          <dt>Agent built</dt>
          <dd>{String(projects.length).padStart(2, '0')}</dd>
          <small>From a single prompt</small>
        </div>
      </dl>
    </div>
  </section>

  <section class="sec">
    <div class="sec-inner">
      <SectionHead
        kicker="01 / Built by hand"
        title={['THE FIELD', 'STUDIES & TOOLS']}
        strap="Long-form arguments you can operate rather than read, and a few tools that had a job to do."
      />

      {#if shownCards.length === 0}
        <p class="empty">Nothing published yet.</p>
      {:else}
        <ul class="grid">
          {#each shownCards as c (c.key)}
            {@render card(c)}
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  {#if projects.length || data.authenticated}
    <section class="sec tinted">
      <div class="sec-inner">
        <SectionHead
          kicker="02 / Built autonomously"
          title={['WRITTEN BY', 'AN AGENT']}
          strap="One prompt in, a working page out. The iteration count is how many passes it took."
        />

        {#if projects.length === 0}
          <p class="empty">No AI-built projects yet.</p>
        {:else}
          <ul class="grid">
            {#each projects as project (project.id)}
              {#snippet removeBtn()}
                {#if data.authenticated}
                  <button
                    class="ctl danger"
                    onclick={() => removeProject(project.id, project.slug!, project.source)}
                    disabled={removing === project.id}
                  >
                    {removing === project.id
                      ? 'Removing…'
                      : project.source === 'repo'
                        ? 'Remove card'
                        : 'Remove'}
                  </button>
                {/if}
              {/snippet}
              {@render card(agentCard(project), removeBtn)}
            {/each}
          </ul>
        {/if}
      </div>
    </section>
  {/if}
</HealthShell>

{#if shareModal}
  <ShareModal
    projectKey={shareModal.key}
    href={shareModal.href}
    title={shareModal.title}
    onClose={() => (shareModal = null)}
  />
{/if}

<style>
  /* --- Cover: the ink band --- */
  .lede {
    padding: clamp(28px, 3.5vw, 48px) clamp(20px, 3vw, 44px);
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
  }
  .lede-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(420px, 0.85fr);
    align-items: end;
    gap: clamp(32px, 5vw, 72px);
    width: min(1400px, 100%);
    margin: 0 auto;
  }
  .lede-copy {
    min-width: 0;
  }
  .eyebrow {
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 4.4vw, 4.1rem);
    font-weight: 900;
    line-height: 0.88;
    letter-spacing: -0.04em;
    color: var(--bg);
    text-wrap: balance;
  }
  h1 span {
    color: transparent;
    -webkit-text-stroke: 1.5px var(--bg);
  }
  .standfirst {
    max-width: 56ch;
    margin: 18px 0 0;
    font-size: var(--fs-body);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.7);
  }

  .bench-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
    margin: 0;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
    border-left: 1px solid rgba(237, 228, 212, 0.16);
  }
  .bench-summary > div {
    min-width: 0;
    padding: 14px;
    border-right: 1px solid rgba(237, 228, 212, 0.16);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    background: rgba(237, 228, 212, 0.04);
  }
  .bench-summary dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
  }
  .bench-summary dd {
    margin: 8px 0 5px;
    font-family: var(--font-display);
    font-size: clamp(1.65rem, 2.4vw, 2.4rem);
    font-weight: 900;
    line-height: 0.9;
    letter-spacing: -0.03em;
    color: var(--bg);
    font-variant-numeric: tabular-nums;
  }
  .bench-summary small {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }

  /* --- Paper sections, on /health's band rhythm --- */
  .sec {
    padding: clamp(44px, 5vw, 76px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
  }
  /* The band rule separates one section from the NEXT. The last one is
     followed by the ink footer, which separates itself — left in, it draws a
     stray rule across the empty space a short page leaves above the foot. */
  section.sec:last-of-type {
    border-bottom: none;
  }
  .sec.tinted {
    background: var(--bg-section);
  }
  .sec-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .empty {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    padding: 30px 2px;
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: clamp(12px, 1.4vw, 18px);
  }

  /* The card: square, shadowless, a hairline that goes to ink on hover — the
     same object the deck shelf and the canvas cards are. */
  .pc {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 22px;
    background: var(--surface-card);
    border: 1px solid var(--card-border);
    transition: border-color var(--t-base) var(--ease-out);
  }
  .pc:hover {
    border-color: var(--text-primary);
  }
  /* Full-bleed hit area UNDER the controls, so the owner's buttons still get
     their own clicks — everything interactive in the foot sits above it. */
  .pc-hit {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  /* Two stacked lines, always. Side by side they fit on one line for a short
     kind ("TOOL") and wrap onto two for a long one ("FIELD STUDY №6"), so
     cards in the same row started their titles at different heights — the
     grid's own alignment was being decided by the length of an eyebrow. */
  .pc-eyebrow {
    display: grid;
    gap: 4px;
    margin-bottom: 12px;
  }
  .pc-kind,
  .pc-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .pc-kind {
    letter-spacing: var(--tracking-label-wide);
    color: var(--accent);
  }
  .pc-tag {
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }

  .pc-title {
    font-family: var(--font-display);
    font-size: 20px;
    line-height: 1.08;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin: 0 0 12px;
    transition: color var(--t-base) var(--ease-out);
  }
  .pc:hover .pc-title {
    color: var(--accent);
  }
  .pc-blurb {
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0 0 18px;
    text-wrap: pretty;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Pinned to the foot, so every card in a row ends on the same line. */
  .pc-foot {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    position: relative;
    z-index: 1;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    background: var(--bg-section);
    padding: 3px 7px;
  }
  .chip.private {
    color: var(--error);
    background: var(--error-bg);
  }

  .owner-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
  .ctl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-secondary);
    background: none;
    border: 1px solid var(--card-border);
    border-radius: 0;
    padding: 4px 8px;
    cursor: pointer;
    transition:
      border-color var(--t-base) var(--ease-out),
      color var(--t-base) var(--ease-out);
  }
  .ctl:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .ctl:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ctl.danger {
    color: var(--error);
    border-color: var(--error);
  }
  .ctl.danger:hover {
    background: var(--error-bg);
    color: var(--error);
    border-color: var(--error);
  }

  @media (max-width: 900px) {
    .lede-inner {
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
    }
  }
  @media (max-width: 520px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .bench-summary {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
