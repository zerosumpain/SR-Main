<svelte:head>
  <title>Projects — Strange Ramblings</title>
  <meta name="description" content="Things I'm building — research tools, experiments, and side projects." />
  <meta property="og:title" content="Projects — Strange Ramblings" />
  <meta property="og:description" content="Things I'm building — research tools, experiments, and side projects." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/projects" />
</svelte:head>

<script lang="ts">
  import SiteNav from '$lib/components/SiteNav.svelte';
</script>

<section class="min-h-screen px-6 sm:px-10 md:px-16 py-8">
  <!-- Header -->
  <div class="mb-12">
    <SiteNav variant="compact" />
  </div>

  <!-- Title -->
  <div class="max-w-4xl mb-12">
    <h1 class="display text-[40px] sm:text-[56px] mb-4" style="color: var(--text-primary);">
      PROJECTS
    </h1>
    <p class="text-base leading-relaxed max-w-lg" style="color: var(--text-secondary);">
      Tools and experiments. Most of these started as a weekend idea and got out of hand.
    </p>
  </div>

  <!-- Project cards -->
  <div class="max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6">
    <!-- Deep Dive -->
    <a
      href="/deepdive"
      class="group block p-6 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Research Agent
        </p>
        <span
          class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: rgba(45, 125, 70, 0.12); color: #2d7d46;"
        >
          Live
        </span>
      </div>
      <h2
        class="display text-[22px] mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        DEEP DIVE
      </h2>
      <p class="text-sm leading-relaxed mb-4" style="color: var(--text-secondary);">
        Multi-phase AI research agent. Searches the web, extracts facts, identifies entities
        and relationships, then red-teams its own findings. Exports full reports as .docx.
      </p>
      <div class="flex gap-3 flex-wrap">
        {#each ['Z.AI', 'Tavily', 'pgvector', 'SSE'] as tag}
          <span
            class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
            style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
          >
            {tag}
          </span>
        {/each}
      </div>
    </a>

    <!-- The Biome -->
    <a
      href="/"
      class="group block p-6 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Living Background
        </p>
        <span
          class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: rgba(45, 125, 70, 0.12); color: #2d7d46;"
        >
          Live
        </span>
      </div>
      <h2
        class="display text-[22px] mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        THE BIOME
      </h2>
      <p class="text-sm leading-relaxed mb-4" style="color: var(--text-secondary);">
        The particle field behind this site. Driven by real-time heart rate, weather, and
        recovery data. WebGL with canvas and static fallbacks.
      </p>
      <div class="flex gap-3 flex-wrap">
        {#each ['Three.js', 'Apple Health', 'Open-Meteo'] as tag}
          <span
            class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
            style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
          >
            {tag}
          </span>
        {/each}
      </div>
    </a>

    <!-- AI Experiments -->
    <a
      href="/projects/jkai"
      class="group block p-6 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Autonomous Builder
        </p>
        <span
          class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: rgba(45, 125, 70, 0.12); color: #2d7d46;"
        >
          Live
        </span>
      </div>
      <h2
        class="display text-[22px] mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        AI EXPERIMENTS
      </h2>
      <p class="text-sm leading-relaxed mb-4" style="color: var(--text-secondary);">
        Projects built autonomously by AI. Each starts as a prompt and is developed iteratively
        by an LLM working in a sandboxed Docker environment.
      </p>
      <div class="flex gap-3 flex-wrap">
        {#each ['LLM', 'Docker', 'Autonomous'] as tag}
          <span
            class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
            style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
          >
            {tag}
          </span>
        {/each}
      </div>
    </a>

    <!-- CDO 100-Day Plan -->
    <a
      href="/cdo-plan"
      class="group block p-6 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Strategic Planner
        </p>
        <span
          class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: rgba(45, 125, 70, 0.12); color: #2d7d46;"
        >
          Live
        </span>
      </div>
      <h2
        class="display text-[22px] mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        100-DAY PLAN
      </h2>
      <p class="text-sm leading-relaxed mb-4" style="color: var(--text-secondary);">
        Living research document for a CDO at the UK Department for Education. AI-powered
        kanban board with themed actions, stakeholders, and milestones across 14 weeks.
      </p>
      <div class="flex gap-3 flex-wrap">
        {#each ['Deep Dive', 'GLM-5.1', 'DfE', 'Kanban'] as tag}
          <span
            class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
            style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
          >
            {tag}
          </span>
        {/each}
      </div>
    </a>

    <!-- Health Dashboard -->
    <a
      href="/health"
      class="group block p-6 rounded-xl border transition-colors"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div class="flex items-start justify-between mb-3">
        <p
          class="text-[10px] uppercase tracking-[0.25em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          Dashboard
        </p>
        <span
          class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
          style="font-family: var(--font-mono); background: rgba(45, 125, 70, 0.12); color: #2d7d46;"
        >
          Live
        </span>
      </div>
      <h2
        class="display text-[22px] mb-3 group-hover:text-[var(--accent)] transition-colors"
        style="color: var(--text-primary);"
      >
        HEALTH
      </h2>
      <p class="text-sm leading-relaxed mb-4" style="color: var(--text-secondary);">
        Readiness scores, sleep analysis, training load, body signals. Pulls from Apple Health,
        Strava, and Whoop via webhooks and OAuth.
      </p>
      <div class="flex gap-3 flex-wrap">
        {#each ['Strava', 'Apple Health', 'D3', 'LayerChart'] as tag}
          <span
            class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
            style="font-family: var(--font-mono); background: var(--bg-section); color: var(--text-ghost);"
          >
            {tag}
          </span>
        {/each}
      </div>
    </a>
  </div>
</section>

<!-- Footer -->
<footer class="px-6 sm:px-10 md:px-16 py-8 flex flex-wrap justify-between items-center gap-4" style="border-top: 2px solid var(--card-border);">
  <p class="display text-[14px]" style="color: var(--text-ghost);">STRANGE RAMBLINGS</p>
  <div class="flex gap-6">
    <a href="https://github.com/jkrup" target="_blank" rel="noopener" class="nav-link">GitHub</a>
    <a href="mailto:john@strangeramblings.com" class="nav-link">Email</a>
    <a href="/" class="nav-link">Home</a>
  </div>
</footer>
