<script lang="ts">
  import type { PageData } from './$types';

  let { data } = $props();
  let projects = $state(data.projects);
  let deleting = $state<string | null>(null);

  function formatDate(d: string | Date) {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  async function removeProject(buildId: string, slug: string) {
    if (!confirm(`Remove published project "${slug}"? This deletes the public files but keeps the build.`)) return;
    deleting = buildId;
    try {
      const res = await fetch(`/api/jkai/builds/${buildId}/unpublish`, { method: 'POST' });
      if (res.ok) {
        projects = projects.filter(p => p.id !== buildId);
      }
    } catch (err) {
      console.error('Failed to remove project:', err);
    } finally {
      deleting = null;
    }
  }
</script>

<svelte:head>
  <title>AI Experiments — Strange Ramblings</title>
  <meta name="description" content="Projects built autonomously by AI — experiments from the JKAI builder." />
</svelte:head>

<section class="min-h-screen px-6 sm:px-10 md:px-16 py-8">
  <div class="flex justify-between items-start mb-12">
    <a href="/" class="display text-[20px] sm:text-[24px] leading-none">SR</a>
    <nav class="flex gap-6 pt-1">
      <a href="/" class="nav-link">Home</a>
      <a href="/projects" class="nav-link">Projects</a>
      <a href="/blog" class="nav-link">Writing</a>
    </nav>
  </div>

  <div class="max-w-4xl mb-12">
    <h1 class="display text-[40px] sm:text-[56px] mb-4" style="color: var(--text-primary);">
      AI EXPERIMENTS
    </h1>
    <p class="text-base leading-relaxed max-w-lg" style="color: var(--text-secondary);">
      Projects built autonomously by AI. Each one started as a prompt and was developed iteratively
      by an LLM working in a sandboxed environment.
    </p>
  </div>

  {#if projects.length === 0}
    <div
      class="max-w-4xl text-center py-16 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p class="text-sm" style="color: var(--text-ghost);">No published experiments yet.</p>
    </div>
  {:else}
    <div class="max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6">
      {#each projects as project}
        <div
          class="group relative p-6 rounded-xl border transition-colors"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <a href="/projects/jkai/{project.publishedSlug}/" class="absolute inset-0 z-0" aria-label="View project"></a>
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
            class="display text-[22px] mb-3 group-hover:text-[var(--accent)] transition-colors"
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
              <button
                onclick={() => removeProject(project.id, project.publishedSlug!)}
                disabled={deleting === project.id}
                class="px-2 py-1 rounded text-[10px] uppercase tracking-wider border transition-colors hover:bg-red-500/10"
                style="border-color: #b43232; color: #b43232; opacity: {deleting === project.id ? 0.5 : 1};"
              >
                {deleting === project.id ? 'Removing...' : 'Remove'}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<footer class="px-6 sm:px-10 md:px-16 py-8 flex flex-wrap justify-between items-center gap-4" style="border-top: 2px solid var(--card-border);">
  <p class="display text-[14px]" style="color: var(--text-ghost);">STRANGE RAMBLINGS</p>
  <div class="flex gap-6">
    <a href="/projects" class="nav-link">Projects</a>
    <a href="/" class="nav-link">Home</a>
  </div>
</footer>
