<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();
  const operation = data.config?.operation || 'list_activities';

  const OPERATION_LABELS: Record<string, string> = {
    list_activities: 'List Activities',
    get_activity: 'Get Activity',
    get_athlete_stats: 'Athlete Stats',
  };
</script>

<BaseNode
  label={data.label}
  nodeType="strava"
  status={data.status}
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
  icon="🚴"
>
  {#snippet extra()}
    <div class="px-3 pb-2">
      <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: #fc4c0222; color: #fc4c02; font-family: var(--font-mono);">
        {OPERATION_LABELS[operation] ?? operation}
      </span>
    </div>
  {/snippet}
</BaseNode>
