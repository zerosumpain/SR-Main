<script lang="ts">
  // The combinations the drives model reads, straight from drives.ts.
  import { CONTEXTS, type Context } from '$lib/landing/ramblers/drives';

  const ROWS = Object.entries(CONTEXTS) as [Context, (typeof CONTEXTS)[Context]][];
</script>

<div class="wrap">
  <table>
    <thead>
      <tr><th>Reading</th><th>When</th><th>What it suggests</th><th>What he does</th></tr>
    </thead>
    <tbody>
      {#each ROWS as [key, c] (key)}
        <tr>
          <td class="k">{c.label}</td>
          <td>{c.signals}</td>
          <td>{c.reads}</td>
          <td>{c.does}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    overflow-x: auto;
    border: 1px solid var(--line-hair);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    min-width: 40rem;
    font-size: 0.9rem;
  }
  th,
  td {
    text-align: left;
    vertical-align: top;
    padding: 0.6rem 0.8rem;
    border-bottom: 1px solid var(--line-hair);
    color: var(--text-secondary);
  }
  th {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  tr:last-child td {
    border-bottom: 0;
  }
  .k {
    color: var(--text-primary);
    font-weight: 600;
    white-space: nowrap;
  }
</style>
