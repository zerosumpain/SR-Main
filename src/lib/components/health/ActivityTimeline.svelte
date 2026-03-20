<script lang="ts">
  let { timeline, onselect }: { timeline: any; onselect?: (event: any) => void } = $props();

  const typeIcons: Record<string, string> = {
    strava_activity: '🏃',
    whoop_workout: '💪',
    whoop_sleep: '😴',
    whoop_recovery: '💚',
  };

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function handleClick(event: any) {
    if (event.type === 'strava_activity' && onselect) {
      // Extract the numeric ID from "strava-12345"
      const id = event.id.replace('strava-', '');
      onselect({ ...event, stravaId: id });
    }
  }
</script>

<section class="max-w-lg mx-auto px-6 sm:px-8">
  <h2 class="text-[10px] uppercase tracking-[0.3em] mb-6" style="color: var(--text-ghost); font-family: var(--font-mono);">
    Recent Activity
  </h2>

  {#if timeline?.events?.length}
    <div class="space-y-3">
      {#each timeline.events as event}
        <button
          class="w-full text-left backdrop-blur-md border rounded-xl p-4 transition-colors {event.type === 'strava_activity' ? 'cursor-pointer hover:border-[var(--accent)]' : ''}"
          style="background: var(--card-bg); border-color: var(--card-border);"
          onclick={() => handleClick(event)}
          disabled={event.type !== 'strava_activity'}
        >
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
            {#if event.type === 'strava_activity'}
              <span class="text-xs" style="color: var(--text-whisper);">→</span>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {:else}
    <p class="text-sm" style="color: var(--text-ghost);">No activity data yet.</p>
  {/if}
</section>
