<script lang="ts">
  let { data, maxDepth = 4 }: { data: unknown; maxDepth?: number } = $props();

  type Row = {
    key: string;
    value: unknown;
    type: string;
    depth: number;
    expandable: boolean;
    preview: string;
  };

  function classify(v: unknown): string {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  function preview(v: unknown, maxLen = 80): string {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return v.length > maxLen ? v.slice(0, maxLen) + '...' : v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`;
    if (typeof v === 'object') {
      const keys = Object.keys(v as Record<string, unknown>);
      return `{${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', ...' : ''}}`;
    }
    return String(v);
  }

  function flatten(obj: unknown, prefix: string, depth: number): Row[] {
    const rows: Row[] = [];
    if (depth > maxDepth) return rows;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const key = prefix ? `${prefix}[${i}]` : `[${i}]`;
        const item = obj[i];
        const type = classify(item);
        const expandable = type === 'object' || type === 'array';
        rows.push({ key, value: item, type, depth, expandable, preview: preview(item) });
        if (expandable) {
          rows.push(...flatten(item, key, depth + 1));
        }
      }
    } else if (obj !== null && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const key = prefix ? `${prefix}.${k}` : k;
        const type = classify(v);
        const expandable = type === 'object' || type === 'array';
        rows.push({ key, value: v, type, depth, expandable, preview: preview(v) });
        if (expandable) {
          rows.push(...flatten(v, key, depth + 1));
        }
      }
    }
    return rows;
  }

  const rows = $derived(flatten(data, '', 0));
  // Track collapsed state per parent key — children hidden when parent collapsed
  let collapsed = $state<Set<string>>(new Set());

  function toggle(key: string) {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsed = next;
  }

  function isVisible(row: Row): boolean {
    // A row is visible if none of its ancestor keys are collapsed.
    // Ancestors are prefixes: "a" is ancestor of "a.b" and "a[0]"
    for (const c of collapsed) {
      if (row.key !== c && row.key.startsWith(c + '.') || row.key.startsWith(c + '[')) {
        return false;
      }
    }
    return true;
  }

  function leafKey(key: string): string {
    // "parsed.tips[0].title" → "title"
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    return parts[parts.length - 1];
  }

  function typeColor(type: string): string {
    switch (type) {
      case 'string': return '#ce9178';
      case 'number': return '#b5cea8';
      case 'boolean': return '#569cd6';
      case 'null': return 'var(--text-ghost)';
      case 'array': return '#dcdcaa';
      case 'object': return '#4ec9b0';
      default: return 'var(--text-primary)';
    }
  }
</script>

{#if data === null || data === undefined}
  <p class="text-xs" style="color: var(--text-ghost);">No data</p>
{:else if typeof data !== 'object'}
  <div class="px-2 py-1 rounded border text-xs" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);">
    {String(data)}
  </div>
{:else}
  <div class="rounded border overflow-hidden" style="border-color: var(--card-border);">
    <table class="w-full text-xs" style="font-family: var(--font-mono);">
      <thead>
        <tr style="background: var(--card-bg);">
          <th class="text-left px-2 py-1.5 font-medium border-b" style="color: var(--text-ghost); border-color: var(--card-border); width: 40%;">Field</th>
          <th class="text-left px-2 py-1.5 font-medium border-b" style="color: var(--text-ghost); border-color: var(--card-border);">Value</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.key)}
          {#if isVisible(row)}
            <tr
              class="transition-colors"
              style="background: {row.depth === 0 ? 'var(--card-bg)' : 'transparent'};"
            >
              <td
                class="px-2 py-1 border-b align-top"
                style="border-color: var(--card-border); padding-left: {8 + row.depth * 12}px;"
              >
                <div class="flex items-center gap-1">
                  {#if row.expandable}
                    <button
                      onclick={() => toggle(row.key)}
                      class="w-3 h-3 flex items-center justify-center text-[9px] shrink-0 rounded"
                      style="color: var(--text-ghost);"
                    >{collapsed.has(row.key) ? '\u25B6' : '\u25BC'}</button>
                  {:else}
                    <span class="w-3 shrink-0"></span>
                  {/if}
                  <span style="color: var(--text-primary);">{leafKey(row.key)}</span>
                  <span class="text-[9px]" style="color: {typeColor(row.type)};">{row.type === 'array' ? `[${(row.value as unknown[]).length}]` : row.type === 'object' ? '{}' : ''}</span>
                </div>
              </td>
              <td
                class="px-2 py-1 border-b align-top"
                style="border-color: var(--card-border); color: {typeColor(row.type)}; word-break: break-word; max-width: 0;"
              >
                {#if !row.expandable}
                  {#if typeof row.value === 'string' && row.value.length > 120}
                    <details>
                      <summary class="cursor-pointer" style="color: {typeColor(row.type)};">{preview(row.value, 80)}</summary>
                      <div class="mt-1 whitespace-pre-wrap" style="color: {typeColor(row.type)};">{row.value}</div>
                    </details>
                  {:else}
                    {row.preview}
                  {/if}
                {:else if collapsed.has(row.key)}
                  <span style="color: var(--text-ghost);">{row.preview}</span>
                {/if}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
{/if}
