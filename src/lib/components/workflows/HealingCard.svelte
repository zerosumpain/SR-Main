<script lang="ts">
  let {
    nodeLabel,
    error,
    attempts,
    status,
    environmentAction,
    alternative,
    undoIds,
    onUndo,
  }: {
    nodeLabel: string;
    error: string;
    attempts: Array<{
      diagnosis: string;
      reasoning: string;
      fixDescription?: string;
      fixApplied: boolean;
      retrySucceeded?: boolean;
      resultError?: string;
    }>;
    status: 'diagnosing' | 'retrying' | 'succeeded' | 'failed' | 'blocked';
    environmentAction?: string;
    alternative?: string;
    undoIds: string[];
    onUndo: (undoId: string) => void;
  } = $props();

  const statusConfig: Record<string, { color: string; icon: string; label: string }> = {
    diagnosing: { color: '#e67e22', icon: '\u{1F50D}', label: 'DIAGNOSING' },
    retrying: { color: '#e67e22', icon: '\u21BB', label: 'RETRYING' },
    succeeded: { color: '#27ae60', icon: '\u2713', label: 'HEALED' },
    failed: { color: '#e74c3c', icon: '\u2717', label: 'COULD NOT FIX' },
    blocked: { color: '#f39c12', icon: '\u26A0', label: 'NEEDS SETUP' },
  };

  let sc = $derived(statusConfig[status] || statusConfig.diagnosing);
</script>

<div class="mb-3 rounded-lg border overflow-hidden" style="border-color: {sc.color}; background: var(--card-bg);">
  <!-- Header -->
  <div class="px-3 py-2 flex items-center gap-2" style="background: color-mix(in srgb, {sc.color} 10%, transparent);">
    {#if status === 'diagnosing' || status === 'retrying'}
      <span class="w-2 h-2 rounded-full animate-pulse" style="background: {sc.color};"></span>
    {:else}
      <span class="text-sm">{sc.icon}</span>
    {/if}
    <span class="text-[11px] uppercase tracking-wider font-medium" style="color: {sc.color};">
      {sc.label}
    </span>
    <span class="text-[11px] ml-auto" style="color: var(--text-ghost);">
      {nodeLabel}
    </span>
  </div>

  <div class="px-3 py-2 space-y-2">
    <!-- Error -->
    <div class="text-[11px] px-2 py-1 rounded" style="background: rgba(231,76,60,0.08); color: #e74c3c; font-family: var(--font-mono); word-break: break-word;">
      {error}
    </div>

    <!-- Attempts -->
    {#each attempts as attempt, i}
      <div class="border-l-2 pl-2 space-y-1" style="border-color: {attempt.retrySucceeded ? '#27ae60' : attempt.fixApplied ? '#e74c3c' : 'var(--card-border)'};">
        <div class="text-[10px] font-medium" style="color: var(--text-ghost);">Attempt {i + 1}</div>

        <div class="text-[11px]" style="color: var(--text-secondary); font-family: var(--font-mono); line-height: 1.5;">
          {attempt.diagnosis}
        </div>

        {#if attempt.reasoning}
          <div class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono); line-height: 1.4;">
            {attempt.reasoning}
          </div>
        {/if}

        {#if attempt.fixDescription}
          <div class="text-[11px] flex items-center gap-1" style="color: {attempt.retrySucceeded ? '#27ae60' : '#e67e22'}; font-family: var(--font-mono);">
            <span>{attempt.retrySucceeded ? '\u2713' : '\u2192'}</span>
            <span>{attempt.fixDescription}</span>
          </div>
        {/if}

        {#if attempt.resultError && !attempt.retrySucceeded}
          <div class="text-[10px]" style="color: #e74c3c; font-family: var(--font-mono);">
            Still failing: {attempt.resultError}
          </div>
        {/if}
      </div>
    {/each}

    <!-- Environment action -->
    {#if environmentAction}
      <div class="rounded p-2 space-y-1" style="background: rgba(243, 156, 18, 0.08);">
        <div class="text-[10px] font-medium uppercase tracking-wider" style="color: #f39c12;">To resolve:</div>
        <div class="text-[11px] whitespace-pre-wrap" style="color: var(--text-primary); font-family: var(--font-mono); line-height: 1.5;">
          {environmentAction}
        </div>
      </div>
    {/if}

    {#if alternative}
      <div class="rounded p-2" style="background: rgba(39, 174, 96, 0.08);">
        <div class="text-[10px] font-medium uppercase tracking-wider" style="color: #27ae60;">Alternative:</div>
        <div class="text-[11px]" style="color: var(--text-secondary); font-family: var(--font-mono);">
          {alternative}
        </div>
      </div>
    {/if}

    <!-- Undo buttons -->
    {#if undoIds.length > 0 && (status === 'succeeded' || status === 'failed')}
      <div class="flex gap-2 pt-1">
        {#each undoIds as undoId, i}
          <button
            onclick={() => onUndo(undoId)}
            class="text-[10px] px-2 py-1 rounded border transition-colors"
            style="border-color: var(--card-border); color: var(--text-ghost);"
          >
            Undo fix {undoIds.length > 1 ? i + 1 : ''}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
