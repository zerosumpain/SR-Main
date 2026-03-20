<script lang="ts">
  let { timeline }: { timeline: any } = $props();

  const typeIcons: Record<string, string> = {
    strava_activity: '🏃',
    whoop_workout: '💪',
    whoop_sleep: '😴',
    whoop_recovery: '💚',
  };

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
</script>

<section class="max-w-lg mx-auto px-6 sm:px-8">
  <h2 class="text-[10px] uppercase tracking-[0.3em] mb-6" style="color: var(--text-ghost); font-family: var(--font-mono);">
    Recent Activity
  </h2>

  {#if timeline?.events?.length}
    <div class="space-y-3">
      {#each timeline.events as event}
        <div class="backdrop-blur-md border rounded-xl p-4" style="background: var(--card-bg); border-color: var(--card-border);">
          <div class="flex items-start gap-3">
            <span class="text-lg">{typeIcons[event.type] || '📊'}</span>
            <div class="flex-1">
              <p class="text-sm font-normal" style="color: var(--text-primary);">{event.title}</p>
              <p class="text-[10px] mt-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
                {formatDate(event.date)}
              </p>
              <div class="flex gap-3 mt-2">
                {#each Object.entries(event.summary) as [key, value]}
                  <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                    {key}: <span style="color: var(--text-secondary);">{value as string}</span>
                  </span>
                {/each}
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-sm" style="color: var(--text-ghost);">No activity data yet.</p>
  {/if}
</section>
