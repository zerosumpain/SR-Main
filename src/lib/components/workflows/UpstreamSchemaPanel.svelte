<script lang="ts">
  let {
    variables = [],
  }: {
    variables: { path: string; type: string; description?: string }[];
  } = $props();

  const TYPE_COLORS: Record<string, string> = {
    string: '#ce9178',
    number: '#b5cea8',
    boolean: '#569cd6',
    object: '#dcdcaa',
    array: '#c586c0',
    any: 'var(--text-ghost)',
  };
</script>

{#if variables.length > 0}
  <div class="mb-3">
    <h4
      class="text-[10px] uppercase tracking-wider mb-2"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      Available Variables
    </h4>
    <div
      class="p-2 rounded border space-y-1 max-h-32 overflow-y-auto"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      {#each variables as variable}
        <div class="flex items-center gap-2 text-xs">
          <span style="font-family: var(--font-mono); color: var(--accent);">
            {'{{'}input.{variable.path}{'}}'}
          </span>
          <span
            class="text-[10px] px-1 rounded"
            style="color: {TYPE_COLORS[variable.type] || 'var(--text-ghost)'};"
          >
            {variable.type}
          </span>
          {#if variable.description}
            <span class="text-[10px] ml-auto truncate" style="color: var(--text-ghost);" title={variable.description}>
              {variable.description}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div class="mb-3">
    <p class="text-[10px]" style="color: var(--text-ghost);">No upstream variables — this node receives no input data.</p>
  </div>
{/if}
