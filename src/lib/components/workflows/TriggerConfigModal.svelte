<script lang="ts">
  let {
    workflowId,
    onClose,
  }: {
    workflowId: string;
    onClose: () => void;
  } = $props();

  type TriggerType = 'manual' | 'cron' | 'event' | 'webhook';

  let triggerType = $state<TriggerType>('manual');
  let cronExpression = $state('0 8 * * *');
  let eventType = $state('strava_activity_synced');
  let saving = $state(false);
  let loading = $state(true);

  const CRON_PRESETS = [
    { label: 'Every day at 8am', value: '0 8 * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 15 minutes', value: '*/15 * * * *' },
    { label: 'Every Monday 9am', value: '0 9 * * 1' },
  ];

  const EVENT_TYPES = [
    { label: 'Strava activity synced', value: 'strava_activity_synced' },
    { label: 'Whoop recovery updated', value: 'whoop_recovery_updated' },
    { label: 'Workflow completed', value: 'workflow_completed' },
  ];

  const webhookUrl = $derived(`${window.location.origin}/api/workflows/webhook/${workflowId}`);

  // Load existing schedule
  $effect(() => {
    fetch(`/api/workflows/${workflowId}/schedule`)
      .then((r) => r.json())
      .then(({ schedule }) => {
        if (schedule) {
          triggerType = schedule.type === 'cron' ? 'cron' : schedule.type === 'event' ? 'event' : 'manual';
          if (schedule.type === 'cron') cronExpression = schedule.config.expression ?? '0 8 * * *';
          if (schedule.type === 'event') eventType = schedule.config.eventType ?? 'strava_activity_synced';
        }
      })
      .finally(() => { loading = false; });
  });

  async function save() {
    saving = true;
    try {
      if (triggerType === 'manual') {
        await fetch(`/api/workflows/${workflowId}/schedule`, { method: 'DELETE' });
      } else if (triggerType === 'webhook') {
        // Webhook trigger stored on workflow.trigger column
        await fetch(`/api/workflows/${workflowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger: { type: 'webhook' } }),
        });
      } else {
        const config = triggerType === 'cron'
          ? { expression: cronExpression }
          : { eventType };
        await fetch(`/api/workflows/${workflowId}/schedule`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: triggerType, config, enabled: true }),
        });
      }
      onClose();
    } finally {
      saving = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog">
  <div class="rounded-xl border p-6 w-[440px] space-y-4" style="background: var(--card-bg); border-color: var(--card-border);">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold" style="color: var(--text-primary);">Trigger Configuration</h2>
      <button onclick={onClose} class="text-xs" style="color: var(--text-ghost);">✕</button>
    </div>

    {#if loading}
      <p class="text-xs" style="color: var(--text-ghost);">Loading...</p>
    {:else}
      <div class="space-y-1">
        <label class="text-xs" style="color: var(--text-ghost);">Trigger type</label>
        <div class="flex gap-2 flex-wrap">
          {#each (['manual', 'cron', 'event', 'webhook'] as TriggerType[]) as t}
            <button
              onclick={() => { triggerType = t; }}
              class="text-xs px-3 py-1.5 rounded border transition-colors"
              style="
                background: {triggerType === t ? 'var(--accent)' : 'var(--card-bg)'};
                border-color: {triggerType === t ? 'var(--accent)' : 'var(--card-border)'};
                color: {triggerType === t ? '#fff' : 'var(--text-secondary)'};
              "
            >
              {t}
            </button>
          {/each}
        </div>
      </div>

      {#if triggerType === 'cron'}
        <div class="space-y-2">
          <label class="text-xs" style="color: var(--text-ghost);">Cron expression</label>
          <input
            bind:value={cronExpression}
            class="w-full text-xs px-3 py-2 rounded border"
            style="background: var(--input-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
            placeholder="0 8 * * *"
          />
          <div class="flex flex-wrap gap-1">
            {#each CRON_PRESETS as preset}
              <button
                onclick={() => { cronExpression = preset.value; }}
                class="text-[10px] px-2 py-1 rounded"
                style="background: var(--card-bg-alt, var(--card-bg)); color: var(--text-ghost); border: 1px solid var(--card-border);"
              >
                {preset.label}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if triggerType === 'event'}
        <div class="space-y-1">
          <label class="text-xs" style="color: var(--text-ghost);">Event type</label>
          <select
            bind:value={eventType}
            class="w-full text-xs px-3 py-2 rounded border"
            style="background: var(--input-bg); border-color: var(--card-border); color: var(--text-primary);"
          >
            {#each EVENT_TYPES as et}
              <option value={et.value}>{et.label}</option>
            {/each}
          </select>
        </div>
      {/if}

      {#if triggerType === 'webhook'}
        <div class="space-y-1">
          <label class="text-xs" style="color: var(--text-ghost);">Webhook URL (POST to trigger)</label>
          <div class="flex gap-2 items-center">
            <code class="text-[10px] flex-1 px-2 py-1.5 rounded border truncate" style="background: var(--card-bg-alt, var(--card-bg)); border-color: var(--card-border); color: var(--text-secondary); font-family: var(--font-mono);">
              {webhookUrl}
            </code>
            <button
              onclick={() => navigator.clipboard.writeText(webhookUrl)}
              class="text-[10px] px-2 py-1.5 rounded border"
              style="border-color: var(--card-border); color: var(--text-ghost);"
            >
              Copy
            </button>
          </div>
        </div>
      {/if}

      <div class="flex justify-end gap-2 pt-2">
        <button
          onclick={onClose}
          class="text-xs px-3 py-1.5 rounded border"
          style="border-color: var(--card-border); color: var(--text-ghost);"
        >
          Cancel
        </button>
        <button
          onclick={save}
          disabled={saving}
          class="text-xs px-4 py-1.5 rounded"
          style="background: var(--accent); color: #fff; opacity: {saving ? 0.6 : 1};"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    {/if}
  </div>
</div>
