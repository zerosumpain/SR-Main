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
    border-radius: 6px;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    background: var(--bg-subtle, rgba(255, 255, 255, 0.04));
    color: var(--text-primary, #e6e6e6);
    font: 11px / 1 ui-monospace, Menlo, monospace;
    cursor: pointer;
  }
  .time-filter:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.07));
  }
</style>
