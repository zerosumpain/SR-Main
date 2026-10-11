<script lang="ts">
  import { isProjectPublic } from '$lib/projects/visibility';
  // Projects — the index of everything built on this site.
  //
  // Read three ways, like the landing page: as a sentence, as a place, or as
  // notes ($lib/components/projects/<view>/). This file keeps everything the
  // views share and none of the drawing: which cards this viewer may see (the
  // server decided), the owner's visibility toggles, Share and Remove, and the
  // "read it as" switch. Every view takes the same props
  // ($lib/projects/views) and renders the owner's controls through ONE
  // snippet, so the controls cannot drift apart between views.
  //
  // Two sections in every view, the split the page's standfirst makes: what
  // was built by hand (`./cards.ts`) and what an agent built from a prompt.
  import type { PageData } from './$types';
  import HealthShell from '$lib/components/shell/HealthShell.svelte';
  import ShareModal from './ShareModal.svelte';
  import type { ProjectCard } from './cards';
  import { resolveProjectCard } from '$lib/jkai/project-card';
  import ViewSwitch from '$lib/components/projects/ViewSwitch.svelte';
  import ProjectsFoot from '$lib/components/projects/ProjectsFoot.svelte';
  import { ProjectsView } from '$lib/components/projects/projects-view.svelte';
  import { countEntries, toEntries, type ProjectEntry } from '$lib/projects/views';

  let { data }: { data: PageData } = $props();
  let projects = $state(data.projects);
  let removing = $state<string | null>(null);
  // The project whose secure-share panel is open (owner-only).
  let shareModal = $state<{ key: string; href: string; title: string } | null>(null);

  // Per-project public/private overlay. Seeded from the server; toggles update
  // it optimistically.
  //
  // A MISSING KEY DOES NOT MEAN PUBLIC. It means public for a hand-built page
  // and PRIVATE for an AI build's slug — `isProjectPublic` is the server's own
  // rule and the only correct reading of an absent row. Assuming public here
  // told the owner a freshly promoted card was live, with no Private chip and a
  // button whose first click read as "make private" when it already was.
  let vis = $state<Record<string, boolean>>({ ...(data.visibility ?? {}) });
  let toggling = $state<string | null>(null);

  const isPub = (key: string) => isProjectPublic(vis, key);
  // The server has already filtered these against the real visibility map —
  // the public's `data.visibility` is empty, so it cannot be filtered here.
  const shownCards = $derived([...data.cards, ...data.ownerCards]);
  // The agent-built cards keep their build id and source beside them, for Remove.
  const builds = $derived(new Map(projects.map((p) => [p.slug!, p])));
  // The public is only ever sent public cards, and its empty map would read an
  // agent build's slug as private, so only the owner's entries ask the map.
  const entries = $derived(toEntries(shownCards, projects.map(agentCard), data.authenticated ? isPub : () => true));
  const counts = $derived(countEntries(entries.hand, entries.agent));

  // The view on screen. Follows the route's data until the visitor picks.
  const view = new ProjectsView(() => ({ choice: data.view, component: data.viewComponent }));
  const View = $derived(view.component);

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

<!-- The owner's controls for one entry, in every view. The public gets
     nothing here at all. -->
{#snippet controls(e: ProjectEntry)}
  {#if data.authenticated}
    {@const build = e.section === 'agent' ? builds.get(e.key) : undefined}
    <span class="owner-controls">
      {#if e.ownerOnly}
        <!-- No toggle and no Share: this card has no `project_visibility` key,
             so the toggle would 400, and a share link would hand out the page. -->
        <span class="ctl-chip private">Owner only</span>
      {:else}
        {#if !isPub(e.key)}<span class="ctl-chip private">Private</span>{/if}
        <button
          class="ctl"
          onclick={() => (shareModal = { key: e.key, href: e.href, title: e.title })}
          title="Create a secure share link — opens this project for a recipient even while private"
        >
          Share
        </button>
        <button
          class="ctl"
          onclick={() => toggleVisibility(e.key)}
          disabled={toggling === e.key}
          title={isPub(e.key)
            ? 'Visible to the public — click to make private'
            : 'Hidden from the public — click to make public'}
        >
          {toggling === e.key ? '…' : isPub(e.key) ? 'Public' : 'Private'}
        </button>
      {/if}
      {#if build}
        <button
          class="ctl danger"
          onclick={() => removeProject(build.id, build.slug!, build.source)}
          disabled={removing === build.id}
        >
          {removing === build.id ? 'Removing…' : build.source === 'repo' ? 'Remove card' : 'Remove'}
        </button>
      {/if}
    </span>
  {/if}
{/snippet}

{#snippet switcher()}
  <ViewSwitch page={view} />
{/snippet}

<!-- No footer strip from the shell: the page closes with the home page's
     footer, in the view on screen (ProjectsFoot). -->
<HealthShell path="/projects" unifiedNav>
  <div class="pv">
    <View
      hand={entries.hand}
      agent={entries.agent}
      showAgent={projects.length > 0 || data.authenticated}
      {counts}
      owner={data.authenticated}
      dateline={data.dateline}
      {controls}
      {switcher}
    />
  </div>
  <ProjectsFoot view={view.view} owner={data.authenticated} />
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
  /* The owner's controls, shared by every view. A view recolours them for its
     own paper or sky through --pc-ctl-ink (words), --pc-ctl-line (the box)
     and --pc-ctl-hot (hover). */
  .owner-controls {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    position: relative;
    z-index: 2;
  }
  .ctl,
  .ctl-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .ctl {
    color: var(--pc-ctl-ink, var(--text-secondary));
    background: none;
    border: 1px solid var(--pc-ctl-line, var(--card-border));
    border-radius: 0;
    padding: 4px 8px;
    cursor: pointer;
    transition:
      border-color var(--t-base) var(--ease-out),
      color var(--t-base) var(--ease-out);
  }
  .ctl:hover {
    border-color: var(--pc-ctl-hot, var(--accent));
    color: var(--pc-ctl-hot, var(--accent));
  }
  .ctl:focus-visible {
    outline: 2px solid var(--pc-ctl-hot, var(--accent));
    outline-offset: 2px;
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
  }
  .ctl-chip {
    padding: 3px 7px;
  }
  .ctl-chip.private {
    color: var(--error);
    background: var(--error-bg);
  }

  /* Named only while a swap runs, so the views crossfade and the nav and
     footer stay still. */
  :global(html.projects-swapping) .pv {
    view-transition-name: projects-view;
  }
  :global(html.projects-swapping::view-transition-old(root)),
  :global(html.projects-swapping::view-transition-new(root)) {
    animation: none;
  }
  :global(html.projects-swapping::view-transition-group(projects-view)),
  :global(html.projects-swapping::view-transition-old(projects-view)),
  :global(html.projects-swapping::view-transition-new(projects-view)) {
    animation-duration: 180ms;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }
</style>
