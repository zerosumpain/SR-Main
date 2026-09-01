<script lang="ts">
  import { appUpdate, applyAppUpdate } from '$lib/jkai/pwa/update-state.svelte';

  let { currentVersion }: { currentVersion: string } = $props();
</script>

{#if appUpdate.available}
  <aside class="update-notice" aria-live="polite">
    <span>
      A newer build{appUpdate.nextVersion ? ` (${appUpdate.nextVersion})` : ''} is ready.
      <small>Current {currentVersion}</small>
    </span>
    <button type="button" onclick={applyAppUpdate} disabled={appUpdate.installing}>
      {appUpdate.installing ? 'Updating…' : 'Update now'}
    </button>
  </aside>
{/if}

<style>
  .update-notice {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    min-height: 38px;
    padding: 6px 16px;
    background: var(--accent-tint-14);
    border-bottom: 1px solid var(--accent);
    color: var(--text-primary);
    font-family: var(--font-body);
    font-size: var(--fs-label);
  }

  small {
    margin-left: 6px;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  button {
    border: 1px solid var(--accent);
    border-radius: 0;
    padding: 5px 10px;
    background: var(--accent);
    color: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  @media (max-width: 599px) {
    .update-notice {
      justify-content: space-between;
      gap: 10px;
    }
    small {
      display: block;
      margin: 2px 0 0;
    }
  }
</style>
