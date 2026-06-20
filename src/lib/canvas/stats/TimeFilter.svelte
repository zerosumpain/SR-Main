<script lang="ts">
  interface Props {
    value: string;
    onchange: (preset: string) => void;
  }
  let { value, onchange }: Props = $props();

  const OPTIONS: Array<{ value: string; label: string }> = [
    { value: '24h', label: 'Last 24h' },
    { value: 'this-week', label: 'This week' },
    { value: 'last-week', label: 'Last week' },
    { value: '30d', label: 'Last 30 days' },
    { value: 'last-month', label: 'Last full month' },
    { value: 'all', label: 'All time' },
  ];
</script>

<select
  class="time-filter"
  {value}
  onchange={(e) => onchange((e.currentTarget as HTMLSelectElement).value)}
  title="Period applied to all stats nodes on this canvas"
>
  {#each OPTIONS as opt (opt.value)}
    <option value={opt.value}>{opt.label}</option>
  {/each}
</select>

<style>
  .time-filter {
    height: 28px;
    padding: 0 8px;
    border-radius: var(--radius-round);
    border: 1px solid var(--card-border);
    background: var(--card-bg);
    color: var(--text-primary);
    font: 11px / 1 ui-monospace, Menlo, monospace;
    cursor: pointer;
  }
  .time-filter:hover {
    background: var(--bg-section);
  }
</style>
