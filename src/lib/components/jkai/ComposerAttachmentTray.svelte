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
        style={`border-color: ${it.incompatible ? '#c0392b' : 'var(--border)'}; background: var(--bg-subtle, rgba(255,255,255,0.05));`}
        title={it.incompatible ? `${it.originalName} — not supported by current model` : it.originalName ?? it.kind}
      >
        {#if it.kind === 'image'}
          <img src={`/api/jkai/attachments/${it.id}`} alt="" class="w-8 h-8 object-cover rounded" />
        {:else if it.kind === 'audio'}
          <span class="text-sm">🎙️</span>
        {:else if it.kind === 'video'}
          <span class="text-sm">🎬</span>
        {:else if it.kind === 'pdf'}
          <span class="text-sm">📄</span>
        {:else}
          <span class="text-sm">📎</span>
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
          <div class="absolute left-0 bottom-0 h-0.5 rounded-b" style="width: 100%; background: var(--accent, #3498db); animation: pulse 1s ease-in-out infinite;"></div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
