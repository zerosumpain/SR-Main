<script lang="ts">
  import { sanitizeNarrativeHtml } from '$lib/security/sanitize-chat';

  let { narrative }: { narrative: { tag: string; text: string } } = $props();

  const safeText = $derived(sanitizeNarrativeHtml(narrative.text));
</script>

<div class="h-narrative">
  <div class="h-narr-icon" aria-hidden="true">→</div>
  <div class="h-narr-body">
    <p class="h-narr-tag">{narrative.tag}</p>
    <p class="h-narr-text">{@html safeText}</p>
  </div>
</div>

<style>
  .h-narrative {
    border: 2px solid var(--card-border);
    padding: 22px 26px;
    background: rgba(26, 16, 8, 0.04);
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 20px;
    align-items: start;
  }
  .h-narr-icon {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 56px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    color: var(--accent);
    border-right: 2px solid var(--card-border);
    padding-right: 20px;
  }
  .h-narr-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .h-narr-tag {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .h-narr-text {
    font-size: 18px;
    line-height: 1.55;
    margin: 0;
    color: var(--text-primary);
    max-width: 780px;
  }
  .h-narr-text :global(em) {
    color: var(--accent);
    font-style: normal;
    font-weight: 500;
  }
  @media (max-width: 720px) {
    .h-narrative {
      padding: 18px;
      grid-template-columns: 1fr;
    }
    .h-narr-icon {
      border-right: none;
      border-bottom: 2px solid var(--card-border);
      padding-right: 0;
      padding-bottom: 12px;
    }
  }
</style>
