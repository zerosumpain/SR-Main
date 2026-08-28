<script lang="ts">
  import type { PageData } from './$types';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ShareModal from './ShareModal.svelte';
  import { resolveProjectCard } from '$lib/jkai/project-card';

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

<PageHeader title="PROJECTS" />

{#snippet visToggle(key: string, href: string, title: string)}
  {#if data.authenticated}
    <span class="flex items-center gap-2 relative z-10 ml-auto">
      {#if !isPub(key)}
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--error-bg); color: var(--error);"
        >
          Private
        </span>
      {/if}
      <button
        onclick={() => (shareModal = { key, href, title })}
        class="px-2 py-1 text-[10px] uppercase tracking-wider border transition-colors"
        style="border-color: var(--card-border); color: var(--text-secondary);"
        title="Create a secure share link — opens this project for a recipient even while private"
      >
        Share
      </button>
      <button
        onclick={() => toggleVisibility(key)}
        disabled={toggling === key}
        class="px-2 py-1 text-[10px] uppercase tracking-wider border transition-colors"
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
  <div class="max-w-2xl mx-auto mb-12 text-center">
    <p class="text-base leading-relaxed" style="color: var(--text-secondary);">
      Things I've built — interactive field studies, strategy games and data tools, several of them
      digging into how government and education data fits together. Some made by hand, some built
      autonomously by an AI agent from a single prompt (those carry an "AI Built" mark).
    </p>
  </div>

  <div class="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
    {#if showCard('bathroom')}
    <div class="project-card group">
      <a href="/projects/bathroom" class="absolute inset-0 z-0" aria-label="Open Bathroom Planner"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Tool
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Interactive · Home project
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        Bathroom Planner — Refitting a Terrace Bathroom
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        Put your own measurements in and drag a bath, a walk-in shower and a wall-hung WC around a
        to-scale floor plan that knows how much room you need to stand in front of each one, and how
        far the toilet has drifted from the soil stack. Then a two-way cost model at 2026 rates —
        set a budget and it picks the spec, or pick the spec and watch it climb — plus who does what,
        the day-by-day programme, and a 47-item snag list to hold the last 5% against.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          to-scale planner · cost model · snag list
        </span>
        {@render visToggle('bathroom', '/projects/bathroom', 'Bathroom Planner')}
      </div>
    </div>
    {/if}

    {#if showCard('scs-earnings')}
    <div class="project-card group">
      <a href="/projects/scs-earnings/" class="absolute inset-0 z-0" aria-label="Open Senior Civil Servant Earnings"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Field Study №6
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Interactive · Pay data
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        Senior Civil Servant Earnings — Fifteen Years of Whitehall Pay
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        How many mandarins out-earn the Prime Minister? What is a digital director worth against a
        policy one? Plot the pay of the 46,595 most senior posts across 25 government departments,
        2010–2026 — by department, profession, grade and the DDaT-vs-policy split, in real terms or
        nominal. Built entirely on gov.uk organogram transparency data, with a full glass-box method.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          gov.uk data · 46,595 posts · OGL
        </span>
        {@render visToggle('scs-earnings', '/projects/scs-earnings/', 'Senior Civil Servant Earnings')}
      </div>
    </div>
    {/if}

    {#if showCard('broads-pilot')}
    <div class="project-card group">
      <a href="/projects/broads-pilot" class="absolute inset-0 z-0" aria-label="Open Broads Pilot"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Field Study №5
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Interactive · Route planner
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        Broads Pilot — Norfolk Broads Route Planner
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        Pick your hire boat, drop a pin, and see exactly where you can get to today — and safely.
        True river-following routing over an OpenStreetMap waterway graph, honouring the 3–6 mph
        speed zones, with travel times, fuel cost and range. Every bridge, the Mutford lock and the
        Breydon tidal crossing are checked against <em>your</em> boat's air draft and beam, with
        moorings, charges, dog-friendly walks and waterside pubs along the way.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          waterway routing · boat-aware · PWA
        </span>
        {@render visToggle('broads-pilot', '/projects/broads-pilot', 'Broads Pilot')}
      </div>
    </div>
    {/if}

    {#if showCard('terminal-descent')}
    <div class="project-card group">
      <a href="/projects/terminal-descent/" class="absolute inset-0 z-0" aria-label="Play Terminal Descent"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Field Study №5
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Playable · WebGL
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        Terminal Descent — A Newtonian Landing Problem
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        A 3D landing game with real Newtonian physics. Gravity pulls; your single engine only
        pushes the way the ship points — so to move, you tilt, burn, then tilt back and burn again
        to kill the drift before you touch down. Manage fuel, thread a procedurally generated
        hazard field, and set down gently, upright and dead-centre on the pad. Scored on touchdown,
        fuel saved and centering, with a global leaderboard. Built autonomously from one prompt.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          Three.js · inertia · leaderboard
        </span>
        {@render visToggle('terminal-descent', '/projects/terminal-descent/', 'Terminal Descent')}
      </div>
    </div>
    {/if}

    {#if showCard('data-standard-designer')}
    <div class="project-card group">
      <a href="/projects/data-standard-designer" class="absolute inset-0 z-0" aria-label="Open the Data Standard Designer"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Tool
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Interactive · Standards
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        Data Standard Designer — Design &amp; Publish a Dataset Standard
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        A workbench for technical teams to design and publish a dataset standard, grounded in the data
        standards government already runs — DfE, NHS, ONS, local-gov and W3C. Capture what the data is
        for, get a schema proposed from established standards, see the live impact on interoperability,
        assurance and adoption, then export a publication-grade standard with the evidence pack behind it.
        Two modes: business analyst and data architect.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          interoperability · assurance · JSON Schema · DCAT-AP
        </span>
        {@render visToggle('data-standard-designer', '/projects/data-standard-designer', 'Data Standard Designer')}
      </div>
    </div>
    {/if}

    {#if showCard('engine-room')}
    <div class="project-card group">
      <a href="/projects/engine-room" class="absolute inset-0 z-0" aria-label="Open The Engine Room"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Field study
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Interactive · This site, explained
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        The Engine Room — how this site works
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        This site looks like a blog. Underneath it is a personal knowledge engine — an assistant with reach into
        mail, files and home, a workflow engine with 88 node types, retrieval over documents, a knowledge graph that
        resolves entities overnight, and a system that rewrites itself while nobody is watching. Four parts,
        twenty-one pages, and twenty instruments you can operate rather than read: follow one message through six
        stages and six layers with a live clock and a running bill, pick a model seller and watch what it costs you,
        try to get machine-written code past the safety scan, or push a change down the deploy pipeline and watch it
        stop. Mechanisms and mistakes, no secrets.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          models · caching · RAG · entity resolution · self-improvement · measured
        </span>
        {@render visToggle('engine-room', '/projects/engine-room', 'The Engine Room')}
      </div>
    </div>
    {/if}

    {#if showCard('data-spine')}
    <div class="project-card group">
      <a href="/projects/data-spine" class="absolute inset-0 z-0" aria-label="Open The Data Spine"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Field study
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Interactive · Data infrastructure
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        The Data Spine — Anatomy of a Promise
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        In one paragraph of a 2026 white paper, the government committed to build a "data spine" for English
        education. This study takes the paragraph seriously: a five-layer anatomy, the international precedents
        (NHS Spine, X-Road, ContactPoint), eight stakeholder lenses on its value, a deep information-governance
        treatment — and a live 3D simulation of the federated design: 24,000 schools, 15 MIS suppliers, thirteen
        runnable scenarios from census day to breach day. Companion to Keystone and the Policy Engine.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          precedents · personas · privacy · 3D federation sim · cited
        </span>
        {@render visToggle('data-spine', '/projects/data-spine', 'The Data Spine')}
      </div>
    </div>
    {/if}

    {#if showCard('dfe-data-strategy')}
    <div class="project-card group">
      <a href="/projects/dfe-data-strategy" class="absolute inset-0 z-0" aria-label="Open Keystone"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Tool
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Interactive · Data strategy
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        Keystone — An Education Strategy Workbench
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        Understand the pressures on an education department's use of data — from across government, from
        its own policy agenda, and from a vast partner system — and shape a strategy that can deliver against
        them. A research-grounded landscape of pressures, frameworks and the data-sharing legal stack, plus a
        private workbench: set your posture and investment levers, and a transparent engine scores coverage,
        maturity and the tensions you create. Upload your own strategy docs to synthesise them in. Companion to
        the Policy Engine.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          pressures · trade-offs · maturity · cited
        </span>
        {@render visToggle('dfe-data-strategy', '/projects/dfe-data-strategy', 'Keystone')}
      </div>
    </div>
    {/if}

    {#if showCard('dfe-data-estate')}
    <div class="project-card group">
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
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          live APIs · 16 services · OGL
        </span>
        {@render visToggle('dfe-data-estate', '/projects/dfe-data-estate', 'The Data Estate')}
      </div>
    </div>
    {/if}

    {#if showCard('policy-engine')}
    <div class="project-card group">
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
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          system dynamics · Monte-Carlo · cited
        </span>
        {@render visToggle('policy-engine', '/projects/policy-engine', 'Education Policy Modelling')}
      </div>
    </div>
    {/if}

    {#if showCard('whitehall')}
    <div class="project-card group">
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
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          Three.js · civil service · special projects
        </span>
        {@render visToggle('whitehall', '/projects/whitehall/', 'Whitehall')}
      </div>
    </div>
    {/if}

    {#if showCard('archetype')}
    <div class="project-card group">
      <a href="/projects/archetype/" class="absolute inset-0 z-0" aria-label="Open Archetype"></a>
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Field Study №7
        </p>
        <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          Playable · WebGL
        </span>
      </div>
      <h2
        class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        Archetype — an arms race you can watch
      </h2>
      <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
        An isometric 4X board game whose real subject is the AI. Six named strategists — the Spear,
        the Jackal, the Sprawl, the Ledger, the Concord, the Bulwark — build models of each other
        from what they can see through the fog, bend their strategy to exploit what they infer, and
        provoke each other into counter-adapting. A strategy observatory shows every drive vector,
        belief and change of mind as it happens.
      </p>
      <div class="flex items-center gap-3 flex-wrap relative z-10">
        <span
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          Three.js · opponent modelling · co-evolution
        </span>
        {@render visToggle('archetype', '/projects/archetype/', 'Archetype')}
      </div>
    </div>
    {/if}

    {#if showCard('brass-and-rails')}
    <div class="project-card group">
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
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          Three.js · tilt-shift · learning AI
        </span>
        {@render visToggle('brass-and-rails', '/projects/brass-and-rails/', 'Brass & Rails')}
      </div>
    </div>
    {/if}

    {#if showCard('data-convergence')}
    <div class="project-card group">
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
          class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
          style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
        >
          Canvas · DAG · braid render
        </span>
        {@render visToggle('data-convergence', '/projects/data-convergence', 'The Spine')}
      </div>
    </div>
    {/if}

    {#if projects.length === 0}
      <div class="project-empty text-center py-16">
        <p class="text-sm" style="color: var(--text-ghost);">No AI-built projects yet.</p>
      </div>
    {:else}
      {#each projects as project (project.id)}
        {@const card = resolveProjectCard(project)}
        <div class="project-card group">
          <a href="/projects/{project.slug}/" class="absolute inset-0 z-0" aria-label="View project"></a>

          <div class="flex items-start justify-between mb-3">
            <p
              class="text-[10px] uppercase tracking-[0.25em]"
              style="color: var(--accent); font-family: var(--font-mono);"
            >
              AI Built
            </p>
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {card.tag || formatDate(project.createdAt)}
            </span>
          </div>

          <h2
            class="text-[20px] font-medium mb-3 group-hover:text-[var(--accent)] transition-colors"
            style="color: var(--text-primary);"
          >
            {card.heading}
          </h2>

          <p class="text-sm leading-relaxed mb-4 line-clamp-3" style="color: var(--text-secondary);">
            {card.blurb}
          </p>

          <div class="flex items-center justify-between relative z-10">
            <div class="flex gap-3 flex-wrap">
              <span
                class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5"
                style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
              >
                {project.iterationsCompleted} iterations
              </span>
            </div>

            {#if data.authenticated}
              <div class="flex items-center gap-2">
                {@render visToggle(project.slug!, `/projects/${project.slug}/`, project.title ?? 'Project')}
                <button
                  onclick={() => removeProject(project.id, project.slug!, project.source)}
                  disabled={removing === project.id}
                  class="remove-btn px-2 py-1 text-[10px] uppercase tracking-wider border transition-colors"
                  style="border-color: var(--error); color: var(--error); opacity: {removing === project.id ? 0.5 : 1};"
                >
                  {removing === project.id ? 'Removing...' : project.source === 'repo' ? 'Remove card' : 'Remove'}
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

{#if shareModal}
  <ShareModal
    projectKey={shareModal.key}
    href={shareModal.href}
    title={shareModal.title}
    onClose={() => (shareModal = null)}
  />
{/if}

<style>
  /* Project cards adopt the /jkai/canvas card idiom: a sharp warm-brutalist
     frame that sits flush on the page's warm-cream surface, defined by a thin
     border that darkens to ink on hover (mirrors `.canvas-card`). */
  .project-card {
    position: relative;
    padding: 1.5rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    transition: border-color 80ms ease;
  }
  .project-card:hover {
    border-color: var(--text-primary);
  }

  .project-empty {
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
  }

  .remove-btn:hover {
    background: var(--error-bg);
  }
</style>
