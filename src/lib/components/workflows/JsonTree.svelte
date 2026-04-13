<script lang="ts">
  let {
    data,
    label = '',
    depth = 0,
    expanded = true,
  }: {
    data: unknown;
    label?: string;
    depth?: number;
    expanded?: boolean;
  } = $props();

  let isOpen = $state(depth < 2 ? expanded : false);
  let isObject = $derived(data !== null && typeof data === 'object');
  let isArray = $derived(Array.isArray(data));
  let entries = $derived(isObject ? Object.entries(data as Record<string, unknown>) : []);

  function typeColor(value: unknown): string {
    if (value === null || value === undefined) return 'var(--text-ghost)';
    if (typeof value === 'string') return '#ce9178';
    if (typeof value === 'number') return '#b5cea8';
    if (typeof value === 'boolean') return '#569cd6';
    return 'var(--text-primary)';
  }

  function formatValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    return String(value);
  }

  function toggle() {
    isOpen = !isOpen;
  }
</script>

<div style="margin-left: {depth > 0 ? 12 : 0}px; font-family: var(--font-mono); font-size: 12px; line-height: 1.6;">
  {#if isObject}
    <div class="flex items-start gap-1 cursor-pointer select-none" onclick={toggle} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter') toggle(); }}>
      <span class="text-[10px]" style="color: var(--text-ghost); width: 12px; display: inline-block;">{isOpen ? '▼' : '▶'}</span>
      {#if label}
        <span style="color: #569cd6;">{label}</span><span style="color: var(--text-ghost);">: </span>
      {/if}
      <span style="color: var(--text-ghost);">{isArray ? `[${entries.length}]` : `{${entries.length}}`}</span>
    </div>
    {#if isOpen}
      {#each entries as [key, value]}
        <svelte:self data={value} label={key} depth={depth + 1} />
      {/each}
    {/if}
  {:else}
    <div class="flex items-start gap-1">
      <span style="width: 12px; display: inline-block;"></span>
      {#if label}
        <span style="color: #569cd6;">{label}</span><span style="color: var(--text-ghost);">: </span>
      {/if}
      <span style="color: {typeColor(data)};">{formatValue(data)}</span>
    </div>
  {/if}
</div>
