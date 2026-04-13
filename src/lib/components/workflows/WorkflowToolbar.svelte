<script lang="ts">
  import TriggerConfigModal from './TriggerConfigModal.svelte';

  let {
    workflowName = '',
    workflowId = null,
    runStatus,
    onSave,
    onRun,
    onStop,
    onNameChange,
    onShowRuns,
  }: {
    workflowName?: string;
    workflowId?: string | null;
    runStatus?: string | null;
    onSave: () => void;
    onRun: () => void;
    onStop: () => void;
    onNameChange: (name: string) => void;
    onShowRuns?: () => void;
  } = $props();

  let editing = $state(false);
  let nameInput = $state(workflowName);
  let isRunning = $derived(runStatus === 'running');
  let showTriggerModal = $state(false);

  function commitName() {
    editing = false;
    if (nameInput.trim() && nameInput !== workflowName) {
      onNameChange(nameInput.trim());
    }
  }
</script>

<div
  class="flex items-center gap-3 px-4 py-2 border-b"
  style="background: var(--bg); border-color: var(--card-border);"
>
  {#if editing}
    <input
      type="text"
      bind:value={nameInput}
      onblur={commitName}
      onkeydown={(e) => { if (e.key === 'Enter') commitName(); }}
      class="px-2 py-1 rounded text-sm border font-medium"
      style="background: var(--card-bg); border-color: var(--accent); color: var(--text-primary);"
      autofocus
    />
  {:else}
    <button
      onclick={() => { editing = true; nameInput = workflowName; }}
      class="text-sm font-medium hover:underline"
      style="color: var(--text-primary);"
    >
      {workflowName || 'Untitled Workflow'}
    </button>
  {/if}

  {#if runStatus}
    <span
      class="text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
      style="font-family: var(--font-mono); background: rgba(100,100,100,0.1); color: var(--text-ghost);"
    >
      {runStatus}
    </span>
  {/if}

  <div class="flex-1"></div>

  <button
    onclick={onSave}
    class="px-3 py-1 rounded text-sm border transition-colors hover:border-[var(--accent)]"
    style="border-color: var(--card-border); color: var(--text-secondary);"
  >
    Save
  </button>

  {#if workflowId}
    <button
      onclick={() => showTriggerModal = true}
      class="px-3 py-1 rounded text-sm border transition-colors hover:border-[var(--accent)]"
      style="border-color: var(--card-border); color: var(--text-secondary);"
    >
      Trigger
    </button>
  {/if}

  {#if onShowRuns}
    <button
      onclick={onShowRuns}
      class="px-3 py-1 rounded text-sm border transition-colors hover:border-[var(--accent)]"
      style="border-color: var(--card-border); color: var(--text-secondary);"
    >
      Runs
    </button>
  {/if}

  {#if isRunning}
    <button
      onclick={onStop}
      class="px-3 py-1 rounded text-sm border transition-colors"
      style="border-color: #b43232; color: #b43232;"
    >
      Stop
    </button>
  {:else}
    <button
      onclick={onRun}
      class="px-3 py-1 rounded text-sm font-medium transition-colors"
      style="background: var(--accent); color: white;"
    >
      Run
    </button>
  {/if}
</div>

{#if showTriggerModal && workflowId}
  <TriggerConfigModal
    {workflowId}
    onClose={() => showTriggerModal = false}
  />
{/if}
