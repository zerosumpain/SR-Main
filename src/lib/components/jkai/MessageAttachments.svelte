<script lang="ts">
  interface Attachment {
    id: string;
    kind: 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'text';
    mimeType: string;
    originalName: string | null;
    sizeBytes: number;
    source: 'web' | 'whatsapp' | 'generated';
  }

  let { attachments = [] }: { attachments: Attachment[] } = $props();
  let lightbox = $state<Attachment | null>(null);

  function fmtSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

{#if attachments.length > 0}
  <div class="flex flex-col gap-2 mt-2">
    {#each attachments as att (att.id)}
      {#if att.kind === 'image'}
        <button
          type="button"
          class="block max-w-xs rounded overflow-hidden cursor-pointer"
          onclick={() => { lightbox = att; }}
          aria-label={att.originalName ?? 'image'}
        >
          <img src={`/api/jkai/attachments/${att.id}`} alt={att.originalName ?? 'image'} class="w-full h-auto" loading="lazy" />
          {#if att.source === 'generated'}
            <span class="text-xs opacity-60 block mt-1">generated</span>
          {/if}
        </button>
      {:else if att.kind === 'audio'}
        <div class="flex flex-col gap-1">
          <audio controls src={`/api/jkai/attachments/${att.id}`} class="max-w-sm"></audio>
          <span class="text-xs opacity-60">{att.originalName ?? 'audio'} · {fmtSize(att.sizeBytes)}{att.source === 'generated' ? ' · generated' : ''}</span>
        </div>
      {:else if att.kind === 'video'}
        <div class="flex flex-col gap-1">
          <!-- svelte-ignore a11y_media_has_caption -->
          <video controls src={`/api/jkai/attachments/${att.id}`} class="max-w-sm rounded"></video>
          <span class="text-xs opacity-60">{att.originalName ?? 'video'} · {fmtSize(att.sizeBytes)}</span>
        </div>
      {:else}
        <a
          href={`/api/jkai/attachments/${att.id}`}
          download={att.originalName ?? undefined}
          class="inline-flex items-center gap-2 px-3 py-2 rounded border max-w-xs"
          style="border-color: var(--border); background: var(--surface-overlay);"
        >
          <span aria-hidden="true">
            {#if att.kind === 'pdf'}
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M5 2.5h6l4 4V17a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 5 17z" /><path d="M11 2.5V6.5h4" />
              </svg>
            {:else if att.kind === 'document'}
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 8.5 8.5 14a2.5 2.5 0 0 1-3.5-3.5l6-6a3.5 3.5 0 0 1 5 5l-6 6" />
              </svg>
            {:else}
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M4 3.5h12v13H4z" /><path d="M6.5 7h7M6.5 10h7M6.5 13h4" />
              </svg>
            {/if}
          </span>
          <span class="flex-1 min-w-0 truncate">{att.originalName ?? att.kind}</span>
          <span class="text-xs opacity-60">{fmtSize(att.sizeBytes)}</span>
        </a>
      {/if}
    {/each}
  </div>

  {#if lightbox}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      style="background: rgba(0,0,0,0.8);"
      onclick={() => { lightbox = null; }}
    >
      <img src={`/api/jkai/attachments/${lightbox.id}`} alt={lightbox.originalName ?? ''} class="max-w-full max-h-full object-contain" />
    </div>
  {/if}
{/if}
