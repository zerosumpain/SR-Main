<script lang="ts">
  import type { PageData } from './$types';

  let { data } = $props();

  const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    running: { bg: 'rgba(45, 125, 70, 0.12)', text: '#2d7d46' },
    paused: { bg: 'rgba(200, 150, 50, 0.12)', text: '#b8860b' },
    completed: { bg: 'rgba(100, 100, 100, 0.12)', text: '#666' },
    failed: { bg: 'rgba(180, 50, 50, 0.12)', text: '#b43232' },
    pending: { bg: 'rgba(100, 100, 200, 0.12)', text: '#6464c8' },
  };

  function formatDate(d: string) {
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
</script>

<svelte:head>
  <title>Autonomous Builds — JKAI</title>
</svelte:head>

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="flex justify-between items-center mb-8">
    <div>
      <h1 class="display text-[32px] sm:text-[40px]" style="color: var(--text-primary);">
        BUILDS
      </h1>
      <p class="text-sm mt-1" style="color: var(--text-secondary);">
        Autonomous AI development projects
      </p>
    </div>
    <a
      href="/jkai/new"
      class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      style="background: var(--accent); color: white;"
    >
      New Build
    </a>
  </div>

  {#if data.builds.length === 0}
    <div
      class="text-center py-16 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p class="text-lg mb-2" style="color: var(--text-secondary);">No builds yet</p>
      <p class="text-sm" style="color: var(--text-ghost);">
        Create your first autonomous build to get started.
      </p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each data.builds as build}
        {@const colors = STATUS_COLORS[build.status] || STATUS_COLORS.pending}
        <a
          href="/jkai/{build.id}"
          class="group block p-5 rounded-xl border transition-colors"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <div class="flex items-start justify-between mb-3">
            <span
              class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
              style="font-family: var(--font-mono); background: {colors.bg}; color: {colors.text};"
            >
              {build.status}
              {#if build.status === 'running'}
                <span class="inline-block w-1.5 h-1.5 rounded-full ml-1 animate-pulse" style="background: {colors.text};"></span>
              {/if}
            </span>
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {formatDate(build.createdAt)}
            </span>
          </div>

          <h2
            class="text-base font-medium mb-2 group-hover:text-[var(--accent)] transition-colors line-clamp-1"
            style="color: var(--text-primary);"
          >
            {build.title || build.prompt.slice(0, 60)}
          </h2>

          <p class="text-sm mb-3 line-clamp-2" style="color: var(--text-secondary);">
            {build.prompt}
          </p>

          <div class="flex items-center gap-4 text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
            <span>{build.iterationsCompleted} iterations</span>
            <span>{budgetSummary(build.budgetConfig)}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
