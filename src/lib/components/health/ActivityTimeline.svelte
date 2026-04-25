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

<section class="nm-sec timeline-wrap">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Recent Activity</span>
  </div>

  {#if timeline?.events?.length}
    <div class="space-y-3">
      {#each timeline.events as event}
        <button
          class="w-full text-left border p-4 transition-colors {event.type === 'strava_activity' ? 'cursor-pointer hover:border-[var(--accent)]' : ''}"
          style="background: var(--card-bg); border-color: var(--card-border);"
          onclick={() => handleClick(event)}
          disabled={event.type !== 'strava_activity'}
        >
          <div class="flex items-start gap-3">
            <span class="text-lg">{typeIcons[event.type] || '📊'}</span>
            <div class="flex-1">
              <p class="text-sm font-normal" style="color: var(--text-primary);">{event.title}</p>
              <p class="sr-label-tight mt-1" style="color: var(--text-ghost);">
                {formatDate(event.date)}
              </p>
              <div class="flex gap-3 mt-2">
                {#each Object.entries(event.summary) as [key, value]}
                  <span class="sr-label-tight" style="color: var(--text-ghost);">
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

<style>
  .timeline-wrap {
    padding: 0 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
  }
</style>
