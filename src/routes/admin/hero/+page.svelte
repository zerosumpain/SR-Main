<svelte:head><title>Hero Titles — Admin</title></svelte:head>

<script lang="ts">
  import { enhance } from '$app/forms';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let submitting = $state(false);
  let formError = $state<string | null>(null);

  function fmtDate(iso: string | null): string {
    if (!iso) return 'never';
    return new Date(iso).toLocaleString('en-GB');
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Landing page"
    title="hero titles"
    sub="The pre-generated set the landing hero snaps to. {data.count} of {data.total} entries; last generated {fmtDate(data.generatedAt)}."
  >
    {#snippet actions()}
      <form
        method="POST"
        action="?/regenerate"
        use:enhance={() => {
          submitting = true;
          return async ({ update, result }) => {
            await update({ reset: false });
            if (result.type === 'failure') {
              formError = (result.data?.message as string) ?? 'Regeneration failed';
            } else {
              formError = null;
            }
            submitting = false;
          };
        }}
      >
        <button
          type="submit"
          class="nm-save-btn"
          disabled={submitting || data.inProgress}
        >
          {data.inProgress ? 'Generating…' : submitting ? 'Starting…' : 'Regenerate all'}
        </button>
      </form>
    {/snippet}
  </PageHeader>

  {#if formError}
    <div class="status-error">{formError}</div>
  {/if}

  {#if data.inProgress}
    <p class="status-note">A regeneration is currently running — reload to refresh status.</p>
  {/if}

  {#if data.rows.length === 0}
    <p class="empty-state">
      No entries yet. The scheduler generates the initial set ~30s after server start,
      or use the button above.
    </p>
  {:else}
    <table class="hero-table">
      <thead>
        <tr>
          <th>HR / Steps / Temp</th>
          <th>Headline</th>
          <th>Strap template</th>
        </tr>
      </thead>
      <tbody>
        {#each data.rows as row (row.id)}
          <tr>
            <td class="cell-meta">{row.hrCentroid} / {row.stepsCentroid.toLocaleString('en-GB')} / {row.tempCentroid}°</td>
            <td class="cell-headline">
              {row.primary} <span class="ghost-text">{row.ghost}</span>
            </td>
            <td class="cell-strap">{row.strapTemplate}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</PageWrap>

<style>
  .status-error {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--status-error);
    margin-bottom: 1rem;
  }

  .status-note {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 1rem;
  }

  .empty-state {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  .hero-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .hero-table thead tr {
    border-bottom: 2px solid var(--card-border);
    text-align: left;
  }

  .hero-table th {
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }

  .hero-table tbody tr {
    border-bottom: 1px solid var(--divider);
  }

  .cell-meta {
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .cell-headline {
    padding: 6px 8px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .ghost-text {
    color: var(--text-ghost);
  }

  .cell-strap {
    padding: 6px 8px;
    color: var(--text-secondary);
  }
</style>
