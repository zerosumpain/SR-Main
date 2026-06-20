<script lang="ts">
  interface PendingAttachment {
    id: string;
    kind: string;
    mimeType: string;
    originalName: string | null;
    sizeBytes: number;
    uploading?: boolean;
    error?: string;
    incompatible?: boolean;
  }

  let { items = [], onRemove }: { items: PendingAttachment[]; onRemove: (id: string) => void } = $props();

  function fmtSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

{#if items.length > 0}
  <div class="flex gap-2 overflow-x-auto py-2 px-1 border-b" style="border-color: var(--border);">
    {#each items as it (it.id)}
      <div
        class="relative flex items-center gap-2 px-2 py-1 rounded border min-w-[160px] max-w-[220px] shrink-0"
        style={`border-color: ${it.incompatible ? 'var(--error)' : 'var(--border)'}; background: var(--surface-overlay);`}
        title={it.incompatible ? `${it.originalName} — not supported by current model` : it.originalName ?? it.kind}
      >
        {#if it.kind === 'image'}
          <img src={`/api/jkai/attachments/${it.id}`} alt="" class="w-8 h-8 object-cover rounded" />
        {:else if it.kind === 'audio'}
          <span class="att-ico" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="7" y="2.5" width="6" height="10" rx="3" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3M7 18h6" />
            </svg>
          </span>
        {:else if it.kind === 'video'}
          <span class="att-ico" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2.5" y="5" width="11" height="10" rx="1.5" /><path d="M13.5 8.5 17.5 6v8l-4-2.5z" />
            </svg>
          </span>
        {:else if it.kind === 'pdf'}
          <span class="att-ico" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M5 2.5h6l4 4V17a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 5 17z" /><path d="M11 2.5V6.5h4" />
            </svg>
          </span>
        {:else}
          <span class="att-ico" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 8.5 8.5 14a2.5 2.5 0 0 1-3.5-3.5l6-6a3.5 3.5 0 0 1 5 5l-6 6" />
            </svg>
          </span>
        {/if}
        <div class="flex-1 min-w-0">
          <div class="text-xs truncate">{it.originalName ?? it.kind}</div>
          <div class="text-[10px] opacity-60">{fmtSize(it.sizeBytes)}</div>
        </div>
        <button
          type="button"
          onclick={() => onRemove(it.id)}
          aria-label="remove"
          class="text-xs opacity-60 hover:opacity-100 shrink-0"
        >×</button>
        {#if it.uploading}
          <div class="absolute left-0 bottom-0 h-0.5 rounded-b" style="width: 100%; background: var(--accent); animation: pulse 1s ease-in-out infinite;"></div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
