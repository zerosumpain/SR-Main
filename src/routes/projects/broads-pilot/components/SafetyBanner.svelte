<script lang="ts">
  // Slim persistent advisory strip. Dismissible per session only — re-shows on
  // reload (local $state, deliberately NOT persisted).
  let dismissed = $state(false);
</script>

{#if !dismissed}
  <div class="safety" role="note" aria-label="Planning advisory">
    <span class="icon" aria-hidden="true">⚠</span>
    <p class="msg">
      <strong>Planning aid only</strong> — bridge clearances are tidal &amp;
      advisory. Always check the on-site gauge boards and Broads Authority
      notices.
    </p>
    <button
      class="close"
      type="button"
      aria-label="Dismiss advisory"
      onclick={() => (dismissed = true)}
    >
      ✕
    </button>
  </div>
{/if}

<style>
  .safety {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.85rem;
    background: color-mix(in srgb, var(--warn) 14%, var(--bg));
    border-bottom: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
    color: var(--text-primary);
  }
  .icon {
    flex: 0 0 auto;
    font-size: 0.95rem;
    line-height: 1;
    color: var(--warn);
  }
  .msg {
    flex: 1 1 auto;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    letter-spacing: 0.01em;
    color: var(--text-secondary);
  }
  .msg strong {
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .close {
    flex: 0 0 auto;
    width: 2.1rem;
    height: 2.1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sharp);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .close:hover {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--warn) 18%, transparent);
  }
  .close:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  @media (min-width: 640px) {
    .msg {
      font-size: var(--fs-label-xs);
    }
  }
</style>
