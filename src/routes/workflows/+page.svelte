<script lang="ts">
  let { data } = $props();

  function formatDate(d: string | Date) {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<svelte:head>
  <title>Workflows</title>
</svelte:head>

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="flex justify-between items-center mb-8">
    <div>
      <h1 class="display text-[32px] sm:text-[40px]" style="color: var(--text-primary);">
        WORKFLOWS
      </h1>
      <p class="text-sm mt-1" style="color: var(--text-secondary);">
        Visual automation pipelines
      </p>
    </div>
    <a
      href="/workflows/new"
      class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      style="background: var(--accent); color: white;"
    >
      New Workflow
    </a>
  </div>

  {#if data.workflows.length === 0}
    <div
      class="text-center py-16 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p class="text-lg mb-2" style="color: var(--text-secondary);">No workflows yet</p>
      <p class="text-sm" style="color: var(--text-ghost);">
        Create your first workflow to get started.
      </p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each data.workflows as workflow}
        <a
          href="/workflows/{workflow.id}"
          class="group p-5 rounded-xl border transition-colors hover:border-[var(--accent)]"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <div class="flex items-start justify-between mb-2">
            <h2
              class="text-base font-medium group-hover:text-[var(--accent)] transition-colors"
              style="color: var(--text-primary);"
            >
              {workflow.name}
            </h2>
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {formatDate(workflow.createdAt)}
            </span>
          </div>
          {#if workflow.description}
            <p class="text-sm line-clamp-2" style="color: var(--text-secondary);">
              {workflow.description}
            </p>
          {/if}
        </a>
      {/each}
    </div>
  {/if}
</div>
