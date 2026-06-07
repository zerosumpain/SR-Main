<script lang="ts">
  import type { PageData } from './$types';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data }: { data: PageData } = $props();
  let projects = $state(data.projects);
  let removing = $state<string | null>(null);

  // Per-project public/private overlay. Seeded from the server; toggles update
  // it optimistically. A missing key means public.
  let vis = $state<Record<string, boolean>>({ ...(data.visibility ?? {}) });
  let toggling = $state<string | null>(null);

  const isPub = (key: string) => vis[key] ?? true;
  const showCard = (key: string) => data.authenticated || isPub(key);

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

  async function removeProject(buildId: string, slug: string) {
    if (!confirm(`Remove published project "${slug}"? This deletes the public files but keeps the build.`)) return;
    removing = buildId;
    try {
      const res = await fetch(`/api/jkai/builds/${buildId}/unpublish`, { method: 'POST' });
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
  <meta name="description" content="Things I'm building — autonomously by AI from a single prompt." />
  <meta property="og:title" content="Projects — Strange Ramblings" />
  <meta property="og:description" content="Things I'm building — autonomously by AI from a single prompt." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/projects" />
</svelte:head>

<PageHeader title="PROJECTS" />

{#snippet visToggle(key: string)}
  {#if data.authenticated}
    <span class="flex items-center gap-2 relative z-10 ml-auto">
      {#if !isPub(key)}
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: rgba(180, 50, 50, 0.12); color: #b43232;"
        >
          Private
        </span>
      {/if}
      <button
        onclick={() => toggleVisibility(key)}
        disabled={toggling === key}
        class="px-2 py-1 rounded text-[10px] uppercase tracking-wider border transition-colors"
        style="border-color: var(--card-border); color: var(--text-secondary); opacity: {toggling === key ? 0.5 : 1};"
        title={isPub(key)
          ? 'Visible to the public — click to make private'
          : 'Hidden from the public — click to make public'}
      >
        {toggling === key ? '…' : isPub(key) ? 'Public' : 'Private'}
      </button>
    </span>
  {/if}
{/snippet}

<section class="min-h-screen px-6 sm:px-10 md:px-16 py-8">
  <div class="max-w-4xl mb-12">
    <p class="text-base leading-relaxed max-w-lg" style="color: var(--text-secondary);">
      Projects built autonomously by AI. Each one started as a prompt and was developed iteratively
      by an LLM working in a sandboxed environment.
    </p>
  </div>

  <div class="max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6">
    {#if showCard('dfe-data-estate')}
    <div
      class="group relative p-6 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <a href="/projects/dfe-data-estate" class="absolute inset-0 z-0" aria-label="Open The Data Estate"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Reference
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Live · DfE APIs
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        The Data Estate — DfE's Public Data Services
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        A fact-checked map of every public-facing service the Department for Education uses to share and
        aggregate data — GIAS, Explore Education Statistics, performance tables, Teaching Vacancies, the
        teacher-training APIs and the restricted pupil-data tier. Where each one's data comes from, how
        often it refreshes, who owns it, and what's open — with six widgets calling the real DfE APIs live.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          live APIs · 16 services · OGL
        </span>
        {@render visToggle('dfe-data-estate')}
      </div>
    </div>
    {/if}

    {#if showCard('policy-engine')}
    <div
      class="group relative p-6 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <a href="/projects/policy-engine" class="absolute inset-0 z-0" aria-label="Open Education Policy Modelling"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Field Study №4
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Interactive · Policy sim
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        Education Policy Modelling — England Schools Simulator
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        A research-backed, system-dynamics simulation of England's schools, 2025–2040. Pull the policy
        levers — SEND &amp; EHCP reform, pupil premium, attendance, early years, the 6,500-teacher pledge,
        curriculum reform — and watch the disadvantage gap, attainment, the SEND funding deficit and NEET
        respond in real calculations. Every effect size is sourced or flagged as an assumption, with
        Monte-Carlo uncertainty and sensitivity analysis.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          system dynamics · Monte-Carlo · cited
        </span>
        {@render visToggle('policy-engine')}
      </div>
    </div>
    {/if}

    {#if showCard('whitehall')}
    <div
      class="group relative p-6 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <a href="/projects/whitehall/" class="absolute inset-0 z-0" aria-label="Play Whitehall"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Field Study №3
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Playable · WebGL
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        Whitehall — The Machinery of Government
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        A turn-based 4X set inside the UK civil service. Cities are government departments, units are
        civil-service grades — Executive Officers, glass-cannon Fast Streamers, Permanent Secretaries —
        and level-10 departments commission national Special Projects for empire-wide bonuses. Play
        solo against an AI that learns from every defeat, or watch eight Whitehall blocs fight it out.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          Three.js · civil service · special projects
        </span>
        {@render visToggle('whitehall')}
      </div>
    </div>
    {/if}

    {#if showCard('brass-and-rails')}
    <div
      class="group relative p-6 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <a href="/projects/brass-and-rails/" class="absolute inset-0 z-0" aria-label="Play Brass & Rails"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Field Study №2
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Playable · WebGL
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        Brass &amp; Rails — An Empire of the Skerne
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        A turn-based 4X empire on a tilt-shift diorama of old Darlington, birthplace of the
        railway. Settle villages, harvest coal &amp; iron, research the Age of Steam — against an
        AI that remembers every defeat and rewrites its strategy to beat you next time. Play solo,
        or watch up to 8 AI houses fight it out autonomously.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          Three.js · tilt-shift · learning AI
        </span>
        {@render visToggle('brass-and-rails')}
      </div>
    </div>
    {/if}

    {#if showCard('data-convergence')}
    <div
      class="group relative p-6 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <a href="/projects/data-convergence" class="absolute inset-0 z-0" aria-label="Open The Spine"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Field Study №1
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          One-shot prompt
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        The Spine — Data Convergence Timeline
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        Scattered data sources are tributaries. They enter as oscillating strands of twine,
        wind together at confluences, and bind into a single horizontal spine — the source
        of truth. Interactive: play, scrub, edit the sources.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          Canvas · DAG · braid render
        </span>
        {@render visToggle('data-convergence')}
      </div>
    </div>
    {/if}

    {#if projects.length === 0}
      <div
        class="text-center py-16 rounded-xl border"
        style="background: var(--card-bg); border-color: var(--card-border);"
      >
        <p class="text-sm" style="color: var(--text-ghost);">No AI-built projects yet.</p>
      </div>
    {:else}
      {#each projects as project (project.id)}
        <div
          class="group relative p-6 rounded-xl border transition-colors"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <a href="/projects/{project.publishedSlug}/" class="absolute inset-0 z-0" aria-label="View project"></a>

          <div class="flex items-start justify-between mb-3">
            <p
              class="text-[10px] uppercase tracking-[0.25em]"
              style="color: var(--accent); font-family: var(--font-mono);"
            >
              AI Built
            </p>
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {formatDate(project.createdAt)}
            </span>
          </div>

          <h2
            class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
            style="color: var(--text-primary);"
          >
            {project.title || project.prompt.slice(0, 40)}
          </h2>

          <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
            {project.prompt}
          </p>

          <div class="flex items-center justify-between relative z-10">
            <div class="flex gap-3 flex-wrap">
              <span
                class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
                style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
              >
                {project.iterationsCompleted} iterations
              </span>
            </div>

            {#if data.authenticated}
              <div class="flex items-center gap-2">
                {@render visToggle(project.publishedSlug!)}
                <button
                  onclick={() => removeProject(project.id, project.publishedSlug!)}
                  disabled={removing === project.id}
                  class="px-2 py-1 rounded text-[10px] uppercase tracking-wider border transition-colors hover:bg-red-500/10"
                  style="border-color: #b43232; color: #b43232; opacity: {removing === project.id ? 0.5 : 1};"
                >
                  {removing === project.id ? 'Removing...' : 'Remove'}
                </button>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</section>

<footer class="px-6 sm:px-10 md:px-16 py-8 flex flex-wrap justify-between items-center gap-4" style="border-top: 2px solid var(--card-border);">
  <p class="brand text-[14px]" style="color: var(--text-ghost);">strange ramblings</p>
  <div class="flex gap-6">
    <a href="https://github.com/jkrup" target="_blank" rel="noopener" class="nav-link">GitHub</a>
    <a href="mailto:john@strangeramblings.com" class="nav-link">Email</a>
    <a href="/" class="nav-link">Home</a>
  </div>
</footer>
