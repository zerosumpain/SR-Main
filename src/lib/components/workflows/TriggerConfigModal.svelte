<script lang="ts">
  let {
    workflowId,
    onClose,
  }: {
    workflowId: string;
    onClose: () => void;
  } = $props();

  type TriggerType = 'manual' | 'cron';

  let triggerType = $state<TriggerType>('manual');
  let cronExpression = $state('0 8 * * *');
  let enabled = $state(true);
  let saving = $state(false);
  let loading = $state(true);
  let hasSchedule = $state(false);
  let status = $state<{ text: string; ok: boolean } | null>(null);
  let lastRunAt = $state<string | null>(null);

  const PRESETS = [
    { label: 'Every minute', value: '* * * * *', desc: 'Runs continuously, once per minute' },
    { label: 'Every 5 min', value: '*/5 * * * *', desc: 'Runs 12 times per hour' },
    { label: 'Every 15 min', value: '*/15 * * * *', desc: 'Runs 4 times per hour' },
    { label: 'Every 30 min', value: '*/30 * * * *', desc: 'Runs twice per hour' },
    { label: 'Hourly', value: '0 * * * *', desc: 'Runs at the top of every hour' },
    { label: 'Every 6 hours', value: '0 */6 * * *', desc: 'Runs at midnight, 6am, noon, 6pm' },
    { label: 'Daily 8am', value: '0 8 * * *', desc: 'Runs once a day at 8:00 AM' },
    { label: 'Daily midnight', value: '0 0 * * *', desc: 'Runs once a day at midnight' },
    { label: 'Mon-Fri 9am', value: '0 9 * * 1-5', desc: 'Weekday mornings at 9:00 AM' },
    { label: 'Weekly Mon 9am', value: '0 9 * * 1', desc: 'Once a week on Monday at 9:00 AM' },
  ];

  function describeCron(expr: string): string {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return 'Invalid expression';
    const [min, hour, dom, mon, dow] = parts;

    const preset = PRESETS.find(p => p.value === expr);
    if (preset) return preset.desc;

    // Basic human-readable generation
    const pieces: string[] = [];

    if (min === '*' && hour === '*') pieces.push('Every minute');
    else if (min.startsWith('*/')) pieces.push(`Every ${min.slice(2)} minutes`);
    else if (hour === '*') pieces.push(`At minute ${min} of every hour`);
    else if (min === '0') pieces.push(`At ${hour.padStart(2, '0')}:00`);
    else pieces.push(`At ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`);

    if (dow === '1-5') pieces.push('on weekdays');
    else if (dow === '0,6') pieces.push('on weekends');
    else if (dow !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayNames = dow.split(',').map(d => days[parseInt(d)] || d).join(', ');
      pieces.push(`on ${dayNames}`);
    }

    if (dom !== '*') pieces.push(`on day ${dom}`);
    if (mon !== '*') pieces.push(`in month ${mon}`);

    return pieces.join(' ');
  }

  let cronDescription = $derived(describeCron(cronExpression));
  let isPreset = $derived(PRESETS.some(p => p.value === cronExpression));

  // Load existing schedule
  $effect(() => {
    fetch(`/api/workflows/${workflowId}/schedule`)
      .then((r) => r.json())
      .then(({ schedule }) => {
        if (schedule) {
          hasSchedule = true;
          triggerType = schedule.type === 'cron' ? 'cron' : 'manual';
          enabled = schedule.enabled;
          lastRunAt = schedule.lastRunAt;
          if (schedule.type === 'cron') {
            cronExpression = schedule.config.expression ?? '0 8 * * *';
          }
        }
      })
      .finally(() => { loading = false; });
  });

  async function save() {
    saving = true;
    status = null;
    try {
      if (triggerType === 'manual') {
        await fetch(`/api/workflows/${workflowId}/schedule`, { method: 'DELETE' });
        hasSchedule = false;
        status = { text: 'Schedule removed', ok: true };
      } else {
        const res = await fetch(`/api/workflows/${workflowId}/schedule`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'cron',
            config: { expression: cronExpression.trim() },
            enabled,
          }),
        });
        if (res.ok) {
          hasSchedule = true;
          status = { text: enabled ? 'Schedule active' : 'Schedule saved (paused)', ok: true };
        } else {
          status = { text: 'Failed to save', ok: false };
        }
      }
    } catch {
      status = { text: 'Failed to save', ok: false };
    } finally {
      saving = false;
    }
  }

  async function remove() {
    saving = true;
    try {
      await fetch(`/api/workflows/${workflowId}/schedule`, { method: 'DELETE' });
      hasSchedule = false;
      triggerType = 'manual';
      status = { text: 'Schedule removed', ok: true };
    } finally {
      saving = false;
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center"
  onclick={onClose}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
>
  <div class="absolute inset-0" style="background: rgba(0,0,0,0.5);"></div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative w-full max-w-lg rounded-xl border shadow-2xl"
    style="background: var(--bg); border-color: var(--card-border);"
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-6 pt-5 pb-3">
      <div>
        <h2 class="text-base font-medium" style="color: var(--text-primary);">Schedule</h2>
        <p class="text-[11px] mt-0.5" style="color: var(--text-ghost);">Set when this workflow runs automatically</p>
      </div>
      <button onclick={onClose} class="text-lg px-2 py-1 rounded transition-colors hover:bg-black/5" style="color: var(--text-ghost);">&times;</button>
    </div>

    {#if loading}
      <div class="px-6 py-12 text-center">
        <p class="text-sm animate-pulse" style="color: var(--text-ghost);">Loading...</p>
      </div>
    {:else}
      <div class="px-6 pb-6 space-y-5">

        <!-- Mode toggle -->
        <div class="flex gap-2">
          <button
            onclick={() => { triggerType = 'manual'; }}
            class="flex-1 px-3 py-2.5 rounded-lg text-sm border transition-colors text-center"
            style="background: {triggerType === 'manual' ? 'var(--card-bg)' : 'transparent'}; border-color: {triggerType === 'manual' ? 'var(--accent)' : 'var(--card-border)'}; color: {triggerType === 'manual' ? 'var(--accent)' : 'var(--text-secondary)'};"
          >
            <div class="font-medium">Manual only</div>
            <div class="text-[10px] mt-0.5" style="color: var(--text-ghost);">Run by hand</div>
          </button>
          <button
            onclick={() => { triggerType = 'cron'; }}
            class="flex-1 px-3 py-2.5 rounded-lg text-sm border transition-colors text-center"
            style="background: {triggerType === 'cron' ? 'var(--card-bg)' : 'transparent'}; border-color: {triggerType === 'cron' ? 'var(--accent)' : 'var(--card-border)'}; color: {triggerType === 'cron' ? 'var(--accent)' : 'var(--text-secondary)'};"
          >
            <div class="font-medium">Scheduled</div>
            <div class="text-[10px] mt-0.5" style="color: var(--text-ghost);">Runs on a timer</div>
          </button>
        </div>

        {#if triggerType === 'cron'}
          <!-- Presets -->
          <div>
            <label class="text-[10px] uppercase tracking-wider mb-2 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
              Frequency
            </label>
            <div class="grid grid-cols-2 gap-1.5">
              {#each PRESETS as preset}
                <button
                  onclick={() => { cronExpression = preset.value; }}
                  class="text-left px-3 py-2 rounded-lg border transition-colors"
                  style="border-color: {cronExpression === preset.value ? 'var(--accent)' : 'var(--card-border)'}; background: {cronExpression === preset.value ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent'};"
                >
                  <div class="text-xs font-medium" style="color: {cronExpression === preset.value ? 'var(--accent)' : 'var(--text-primary)'};">
                    {preset.label}
                  </div>
                </button>
              {/each}
            </div>
          </div>

          <!-- Custom expression -->
          <div>
            <label class="text-[10px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {isPreset ? 'Expression' : 'Custom expression'}
            </label>
            <input
              type="text"
              bind:value={cronExpression}
              placeholder="* * * * *"
              class="w-full px-3 py-2 rounded-lg text-sm border"
              style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
            />
            <!-- Human-readable description -->
            <p class="text-[11px] mt-1.5 px-1" style="color: var(--accent);">
              {cronDescription}
            </p>
          </div>

          <!-- Enabled toggle -->
          <div class="flex items-center justify-between px-3 py-2.5 rounded-lg border" style="border-color: var(--card-border);">
            <div>
              <div class="text-sm" style="color: var(--text-primary);">Active</div>
              <div class="text-[10px]" style="color: var(--text-ghost);">{enabled ? 'Workflow will run on schedule' : 'Schedule is paused'}</div>
            </div>
            <button
              onclick={() => { enabled = !enabled; }}
              class="w-11 h-6 rounded-full transition-colors relative flex-shrink-0"
              style="background: {enabled ? 'var(--accent)' : 'var(--card-border)'};"
            >
              <span
                class="absolute top-1 w-4 h-4 rounded-full bg-white transition-all"
                style="left: {enabled ? '24px' : '4px'};"
              ></span>
            </button>
          </div>

          <!-- Schedule info -->
          {#if hasSchedule}
            <div class="flex gap-4 text-[11px] px-1" style="font-family: var(--font-mono);">
              <span style="color: var(--text-ghost);">Last run: <span style="color: var(--text-secondary);">{formatDate(lastRunAt)}</span></span>
            </div>
          {/if}
        {/if}

        <!-- Actions -->
        <div class="flex items-center gap-2 pt-1">
          <button
            onclick={save}
            disabled={saving || (triggerType === 'cron' && !cronExpression.trim())}
            class="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style="background: var(--accent); color: white; opacity: {saving || (triggerType === 'cron' && !cronExpression.trim()) ? 0.5 : 1};"
          >
            {#if saving}
              Saving...
            {:else if triggerType === 'manual' && hasSchedule}
              Remove Schedule
            {:else if triggerType === 'manual'}
              Close
            {:else if hasSchedule}
              Update Schedule
            {:else}
              Set Schedule
            {/if}
          </button>

          {#if hasSchedule && triggerType === 'cron'}
            <button
              onclick={remove}
              disabled={saving}
              class="px-4 py-2.5 rounded-lg text-sm border transition-colors"
              style="border-color: var(--card-border); color: var(--text-secondary);"
            >
              Remove
            </button>
          {/if}
        </div>

        {#if status}
          <p class="text-xs text-center" style="color: {status.ok ? '#2d7d46' : '#b43232'};">
            {status.text}
          </p>
        {/if}
      </div>
    {/if}
  </div>
</div>
