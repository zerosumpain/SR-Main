<script lang="ts">
  let { readiness }: { readiness: any } = $props();

  const scoreColor = readiness?.score >= 70 ? 'var(--accent)' : readiness?.score >= 50 ? 'var(--text-secondary)' : 'var(--text-muted)';
</script>

<section class="h-screen flex flex-col items-center justify-center px-6 sm:px-10 md:px-16">
  {#if readiness}
    <p class="label mb-4">Readiness</p>
    <p class="display text-[80px] sm:text-[120px] md:text-[160px]" style="color: {scoreColor};">
      {Math.round(readiness.score)}
    </p>
    <p class="display text-[18px] sm:text-[22px] mt-2" style="color: var(--text-secondary);">
      {readiness.label.toUpperCase()}
    </p>
    <p class="text-sm mt-3" style="color: var(--text-muted);">
      {readiness.recommendation}
    </p>

    <!-- Factors -->
    <div class="flex gap-6 sm:gap-10 mt-10">
      {#each Object.entries(readiness.factors) as [key, factor]}
        <div class="text-center">
          <p class="label" style="font-size: 10px;">
            {key.replace(/([A-Z])/g, ' $1').trim().toUpperCase()}
          </p>
          <p class="display text-[24px] sm:text-[28px] mt-1" style="color: var(--text-primary);">
            {Math.round((factor as any).value)}
          </p>
        </div>
      {/each}
    </div>
  {:else}
    <p class="label">No readiness data available</p>
  {/if}
</section>
