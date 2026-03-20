<script lang="ts">
  let { readiness }: { readiness: any } = $props();

  const scoreColor = readiness?.score >= 70 ? 'var(--accent)' : readiness?.score >= 50 ? 'var(--text-secondary)' : 'var(--text-ghost)';
</script>

<section class="h-screen flex flex-col items-center justify-center px-8">
  {#if readiness}
    <p class="text-[10px] uppercase tracking-[0.4em] mb-4" style="color: var(--text-ghost); font-family: var(--font-mono);">
      Readiness
    </p>
    <p class="text-[80px] sm:text-[120px] font-thin leading-none" style="color: {scoreColor};">
      {Math.round(readiness.score)}
    </p>
    <p class="text-sm mt-4 font-light" style="color: var(--text-secondary);">
      {readiness.label}
    </p>
    <p class="text-xs mt-2" style="color: var(--text-ghost); font-family: var(--font-mono);">
      {readiness.recommendation}
    </p>

    <!-- Factors -->
    <div class="flex gap-8 mt-10">
      {#each Object.entries(readiness.factors) as [key, factor]}
        <div class="text-center">
          <p class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
            {key.replace(/([A-Z])/g, ' $1').trim()}
          </p>
          <p class="text-lg font-light mt-1" style="color: var(--text-secondary);">
            {Math.round((factor as any).value)}
          </p>
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-sm" style="color: var(--text-ghost);">No readiness data available</p>
  {/if}
</section>
