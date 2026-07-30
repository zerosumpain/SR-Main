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

  /** Short uppercase type badge — `PDF`, `DOCX`, `WAV`. Falls back to the kind
   *  when the filename has no extension. */
  function typeBadge(att: Attachment): string {
    const ext = att.originalName?.match(/\.([a-z0-9]{1,5})$/i)?.[1];
    return (ext || att.kind).toUpperCase();
  }

  // The image cell and the row stack are one block with hairline dividers, so a
  // multimodal turn reads as a single attachment rather than a pile of cards.
  const images = $derived(attachments.filter((a) => a.kind === 'image'));
  const rows = $derived(attachments.filter((a) => a.kind !== 'image'));
</script>

{#if attachments.length > 0}
  <div class="att-block">
    {#each images as att (att.id)}
      <button
        type="button"
        class="att-image"
        onclick={() => {
          lightbox = att;
        }}
        aria-label={att.originalName ?? 'image'}
      >
        <img src={`/api/jkai/attachments/${att.id}`} alt={att.originalName ?? 'image'} loading="lazy" />
        <span class="att-caption">
          {typeBadge(att)} · {fmtSize(att.sizeBytes)}{att.source === 'generated' ? ' · GENERATED' : ''}
        </span>
      </button>
    {/each}

    {#if rows.length > 0}
      <div class="att-rows">
        {#each rows as att (att.id)}
          {#if att.kind === 'audio'}
            <div class="att-row">
              <span class="att-badge">{typeBadge(att)}</span>
              <audio controls src={`/api/jkai/attachments/${att.id}`}></audio>
              <span class="att-meta">{fmtSize(att.sizeBytes)}</span>
            </div>
          {:else if att.kind === 'video'}
            <div class="att-row att-row--media">
              <!-- svelte-ignore a11y_media_has_caption -->
              <video controls src={`/api/jkai/attachments/${att.id}`}></video>
              <span class="att-meta">{att.originalName ?? 'video'} · {fmtSize(att.sizeBytes)}</span>
            </div>
          {:else}
            <a class="att-row" href={`/api/jkai/attachments/${att.id}`} download={att.originalName ?? undefined}>
              <span class="att-badge">{typeBadge(att)}</span>
              <span class="att-name">{att.originalName ?? att.kind}</span>
              <span class="att-meta">{fmtSize(att.sizeBytes)}</span>
            </a>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  {#if lightbox}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="att-lightbox"
      onclick={() => {
        lightbox = null;
      }}
    >
      <img src={`/api/jkai/attachments/${lightbox.id}`} alt={lightbox.originalName ?? ''} />
    </div>
  {/if}
{/if}

<style>
  /* The gap colour IS the divider — a 1px grid gap over a tinted background,
     so the block needs no internal borders. */
  .att-block {
    display: grid;
    grid-template-columns: 168px 1fr;
    gap: 1px;
    margin-top: 8px;
    background: rgba(26, 16, 8, 0.12);
    border: 1px solid var(--card-border);
  }
  /* An attachment set with no image is just the row stack, full width. */
  .att-block:not(:has(.att-image)) {
    grid-template-columns: 1fr;
  }

  .att-image {
    position: relative;
    display: block;
    height: 112px;
    padding: 0;
    border: none;
    background: var(--bg);
    cursor: pointer;
    overflow: hidden;
  }
  .att-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .att-caption {
    position: absolute;
    left: 0;
    bottom: 0;
    max-width: 100%;
    padding: 3px 6px;
    background: rgba(26, 16, 8, 0.82);
    color: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .att-rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: rgba(26, 16, 8, 0.12);
  }
  .att-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    padding: 8px 11px;
    background: var(--bg);
    text-decoration: none;
    min-width: 0;
  }
  .att-row--media {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .att-row:hover .att-name {
    color: var(--accent);
  }
  .att-badge {
    flex: none;
    padding: 3px 5px;
    border: 1px solid var(--accent-tint-35);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .att-name {
    flex: 1;
    min-width: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .att-meta {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(26, 16, 8, 0.5);
    white-space: nowrap;
  }
  .att-row audio {
    flex: 1;
    min-width: 0;
    height: 28px;
  }
  .att-row video {
    width: 100%;
    max-height: 240px;
  }

  .att-lightbox {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(26, 16, 8, 0.88);
  }
  .att-lightbox img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  /* Phone (2a): the 168px | 1fr grid becomes a vertical stack. */
  @media (max-width: 799px) {
    .att-block {
      grid-template-columns: 1fr;
    }
    .att-image {
      height: 104px;
    }
    .att-row {
      min-height: 44px;
    }
    .att-name {
      font-size: var(--fs-label);
    }
    .att-meta,
    .att-caption {
      font-size: var(--fs-label-xs);
    }
  }
</style>
