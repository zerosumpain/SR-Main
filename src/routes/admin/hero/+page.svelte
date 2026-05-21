<svelte:head><title>Hero Titles — Admin</title></svelte:head>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let submitting = $state(false);

  function fmtDate(iso: string | null): string {
    if (!iso) return 'never';
    return new Date(iso).toLocaleString('en-GB');
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Landing page"
    title="hero titles"
    sub="The pre-generated set the landing hero snaps to. {data.count} of 150 entries; last generated {fmtDate(data.generatedAt)}."
  />

  <form
    method="POST"
    action="?/regenerate"
    use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        await update();
        submitting = false;
        await invalidateAll();
      };
    }}
    style="margin-bottom: 1.5rem;"
  >
    <button
      type="submit"
      disabled={submitting || data.inProgress}
      style="font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; padding: 8px 16px; background: var(--accent); color: #fff; border: none; cursor: pointer;"
    >
      {data.inProgress ? 'Generating…' : submitting ? 'Starting…' : 'Regenerate all'}
    </button>
    {#if data.inProgress}
      <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-left: 10px;">
        A regeneration is currently running — reload to refresh status.
      </span>
    {/if}
  </form>

  {#if data.rows.length === 0}
    <p style="color: var(--text-muted); font-size: 14px;">
      No entries yet. The scheduler generates the initial set ~30s after server start,
      or use the button above.
    </p>
  {:else}
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--card-border);">
          <th style="padding: 6px 8px; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted);">HR / Steps / Temp</th>
          <th style="padding: 6px 8px; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted);">Headline</th>
          <th style="padding: 6px 8px; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted);">Strap template</th>
        </tr>
      </thead>
      <tbody>
        {#each data.rows as row (row.id)}
          <tr style="border-bottom: 1px solid var(--divider);">
            <td style="padding: 6px 8px; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); white-space: nowrap;">
              {row.hrCentroid} / {row.stepsCentroid.toLocaleString('en-GB')} / {row.tempCentroid}°
            </td>
            <td style="padding: 6px 8px; font-weight: 600; color: var(--text-primary); white-space: nowrap;">
              {row.primary} <span style="color: var(--text-ghost);">{row.ghost}</span>
            </td>
            <td style="padding: 6px 8px; color: var(--text-secondary);">{row.strapTemplate}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</PageWrap>
