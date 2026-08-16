<script lang="ts">
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';

  let {
    thinking,
  }: {
    thinking: OrchestratorThinking;
  } = $props();

  let debateOpen = $state(false);

  const icons: Record<string, string> = {
    search: '\u{1F50D}',
    use_node: '\u2713',
    create_node: '\u002B',
    connect: '\u{1F517}',
    ask_user: '\u003F',
    finalize: '\u2705',
  };
</script>

<div class="space-y-1 mt-2">
  {#each thinking.steps as step}
    <div class="flex gap-2 items-start py-1">
      <span class="text-xs shrink-0 w-5 text-center" style="color: var(--text-ghost);">
        {icons[step.type] || '-'}
      </span>
      <div class="min-w-0">
        <p class="text-[11px] font-medium" style="color: var(--text-primary);">
          {step.summary}
        </p>
        {#if step.detail}
          <p class="text-[10px] mt-0.5 whitespace-pre-wrap break-words" style="color: var(--text-ghost); font-family: var(--font-mono); line-height: 1.5;">
            {step.detail}
          </p>
        {/if}
      </div>
    </div>
  {/each}

  {#if thinking.debate.issues.length > 0 || thinking.debate.revisions.length > 0}
    <button
      onclick={() => { debateOpen = !debateOpen; }}
      class="mt-2 text-[10px] uppercase tracking-wider flex items-center gap-1"
      style="color: var(--text-ghost);"
    >
      <span>{debateOpen ? '\u25BC' : '\u25B6'}</span>
      <span>Debate ({thinking.debate.issues.length} issue{thinking.debate.issues.length !== 1 ? 's' : ''})</span>
    </button>

    {#if debateOpen}
      <div class="mt-1 space-y-2">
        <div class="rounded p-2" style="background: var(--surface-sunken);">
          <div class="text-[10px] font-medium mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
            PROPOSAL: {thinking.debate.proposal.nodeCount} nodes, {thinking.debate.proposal.edgeCount} edges
            {#if thinking.debate.proposal.newNodes.length > 0}
              ({thinking.debate.proposal.newNodes.length} new)
            {/if}
          </div>
        </div>

        {#if thinking.debate.issues.length > 0}
          <div class="rounded p-2" style="background: var(--surface-sunken);">
            <div class="text-[10px] font-medium mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">CRITIQUE</div>
            {#each thinking.debate.issues as issue}
              <div class="text-[10px] py-0.5" style="color: var(--text-secondary); font-family: var(--font-mono);">
                <span class="font-medium" style="color: {issue.severity === 'MISSING' ? 'var(--warn)' : issue.severity === 'MISMATCH' ? 'var(--error)' : 'var(--text-ghost)'};">
                  {issue.severity}
                </span>
                {#if issue.nodeId}<span style="color: var(--text-ghost);"> [{issue.nodeId}]</span>{/if}
                {' '}{issue.message}
              </div>
            {/each}
          </div>
        {/if}

        {#if thinking.debate.revisions.length > 0}
          <div class="rounded p-2" style="background: var(--surface-sunken);">
            <div class="text-[10px] font-medium mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">REVISIONS</div>
            {#each thinking.debate.revisions as rev}
              <div class="text-[10px] py-0.5" style="color: var(--text-secondary); font-family: var(--font-mono);">
                <span class="font-medium">{rev.action}</span>
                {#if rev.nodeId}<span style="color: var(--text-ghost);"> [{rev.nodeId}]</span>{/if}
                {' '}{rev.description}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
