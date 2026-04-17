<script lang="ts">
  import type { TableArtifact } from '$lib/workflows/site-tools/artifact-types';

  let { artifact }: { artifact: TableArtifact } = $props();

  let sortKey = $state<string | null>(null);
  let sortDir = $state<'asc' | 'desc'>('asc');

  const sortedRows = $derived.by(() => {
    if (!sortKey) return artifact.rows;
    const key = sortKey;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...artifact.rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return -1 * dir;
      if (bv == null) return 1 * dir;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  });

  function toggleSort(key: string) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  function fmt(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  }
</script>

<figure class="table-artifact">
  {#if artifact.caption}
    <figcaption>{artifact.caption}</figcaption>
  {/if}
  <div class="scroll">
    <table>
      <thead>
        <tr>
          {#each artifact.columns as col (col.key)}
            <th
              class:align-right={col.align === 'right'}
              class:align-center={col.align === 'center'}
              onclick={() => toggleSort(col.key)}
            >
              {col.label}
              {#if sortKey === col.key}
                <span class="sort-indicator">{sortDir === 'asc' ? '▲' : '▼'}</span>
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each sortedRows as row}
          <tr>
            {#each artifact.columns as col (col.key)}
              <td
                class:align-right={col.align === 'right'}
                class:align-center={col.align === 'center'}
              >
                {fmt(row[col.key])}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</figure>

<style>
  .table-artifact {
    margin: 0.5rem 0;
    border: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
    border-radius: 6px;
    overflow: hidden;
    max-width: 100%;
  }
  figcaption {
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 600;
    background: rgb(var(--muted-rgb, 240 240 240) / 0.4);
    border-bottom: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
  }
  .scroll {
    max-height: 400px;
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  th {
    position: sticky;
    top: 0;
    background: rgb(var(--bg-rgb, 255 255 255));
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  td {
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.2);
  }
  tr:last-child td { border-bottom: none; }
  .align-right { text-align: right; }
  .align-center { text-align: center; }
  .sort-indicator { margin-left: 0.25rem; font-size: 0.7rem; }
</style>
