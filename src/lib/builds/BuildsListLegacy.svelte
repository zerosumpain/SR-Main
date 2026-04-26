<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { builds: initialBuilds }: { builds: any[] } = $props();
  let builds = $state(initialBuilds);
  let publishing = $state<string | null>(null);
  let deleting = $state<string | null>(null);

  const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    running: { bg: 'rgba(45, 125, 70, 0.12)', text: '#2d7d46' },
    paused: { bg: 'rgba(200, 150, 50, 0.12)', text: '#b8860b' },
    completed: { bg: 'rgba(100, 100, 100, 0.12)', text: '#666' },
    failed: { bg: 'rgba(180, 50, 50, 0.12)', text: '#b43232' },
    pending: { bg: 'rgba(100, 100, 200, 0.12)', text: '#6464c8' },
  };

  function formatDate(d: string | Date) {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function budgetSummary(config: any): string {
    const parts: string[] = [];
    if (config?.activeMinutesPerHour) parts.push(`${config.activeMinutesPerHour}m/hr`);
    if (config?.maxIterations) parts.push(`${config.maxIterations} iters`);
    if (config?.maxTotalMinutes) parts.push(`${config.maxTotalMinutes}m total`);
    return parts.join(' · ') || 'No limits';
  }

  async function deleteBuild(buildId: string, label: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete this build?\n\n"${label}"\n\nAll iterations and logs will be permanently removed.`)) return;
    deleting = buildId;
    try {
      const res = await fetch(`/api/jkai/builds/${buildId}`, { method: 'DELETE' });
      if (res.ok) {
        builds = builds.filter((b) => b.id !== buildId);
      } else {
        const body = await res.json().catch(() => ({}));
        alert(`Delete failed: ${body.error ?? res.statusText}`);
      }
    } finally {
      deleting = null;
    }
  }

  async function publishBuild(buildId: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    publishing = buildId;
    try {
      const res = await fetch(`/api/jkai/builds/${buildId}/publish`, { method: 'POST' });
      const result = await res.json();
      if (res.ok && result.slug) {
        builds = builds.map((b) => (b.id === buildId ? { ...b, publishedSlug: result.slug } : b));
      }
    } finally {
      publishing = null;
    }
  }
</script>

<PageHeader title="BUILDS" />

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="flex justify-between items-center mb-8">
    <div>
      <p class="text-sm" style="color: var(--text-secondary);">Autonomous AI development projects</p>
    </div>
    <a
      href="/jkai/builds/new"
      class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      style="background: var(--accent); color: white;"
    >
      New Build
    </a>
  </div>

  {#if builds.length === 0}
    <div
      class="text-center py-16 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p class="text-lg mb-2" style="color: var(--text-secondary);">No builds yet</p>
      <p class="text-sm" style="color: var(--text-ghost);">Create your first autonomous build to get started.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each builds as build}
        {@const colors = STATUS_COLORS[build.status] || STATUS_COLORS.pending}
        <div class="group relative p-5 rounded-xl border transition-colors" style="background: var(--card-bg); border-color: var(--card-border);">
          <a href="/jkai/builds/{build.id}" class="absolute inset-0 z-0" aria-label="View build"></a>
          <div class="flex items-start justify-between mb-3">
            <span class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded" style="font-family: var(--font-mono); background: {colors.bg}; color: {colors.text};">
              {build.status}
              {#if build.status === 'running'}
                <span class="inline-block w-1.5 h-1.5 rounded-full ml-1 animate-pulse" style="background: {colors.text};"></span>
              {/if}
            </span>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">{formatDate(build.createdAt)}</span>
              <button onclick={(e) => deleteBuild(build.id, build.title || build.prompt.slice(0, 60), e)} disabled={deleting === build.id} class="relative z-10 px-2 py-0.5 rounded border transition-all text-[10px] uppercase tracking-wider {deleting === build.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}" style="color: #b43232; border-color: #b43232; background: rgba(180, 50, 50, 0.08);" title="Delete build">
                {deleting === build.id ? '...' : 'Delete'}
              </button>
            </div>
          </div>
          <h2 class="text-base font-medium mb-2 group-hover:text-[var(--accent)] transition-colors line-clamp-1" style="color: var(--text-primary);">
            {build.title || build.prompt.slice(0, 60)}
          </h2>
          <p class="text-sm mb-3 line-clamp-2" style="color: var(--text-secondary);">{build.prompt}</p>
          <div class="flex items-center justify-between relative z-10">
            <div class="flex items-center gap-4 text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              <span>{build.iterationsCompleted} iterations</span>
              <span>{budgetSummary(build.budgetConfig)}</span>
            </div>
            {#if build.status === 'completed' || build.status === 'paused'}
              {#if build.publishedSlug}
                <a href="/projects/jkai/{build.publishedSlug}/" target="_blank" class="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border transition-colors hover:opacity-80" style="border-color: #2d7d46; color: #2d7d46;">Published</a>
              {:else}
                <button onclick={(e) => publishBuild(build.id, e)} disabled={publishing === build.id} class="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border transition-colors hover:opacity-80" style="border-color: var(--accent); color: var(--accent); opacity: {publishing === build.id ? 0.5 : 1};">
                  {publishing === build.id ? 'Publishing...' : 'Publish'}
                </button>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
