<script lang="ts">
  type Props = {
    url: string;
    sourceNodeId: string;
    onCreate: (event: { url: string; fromNodeId: string }) => void;
  };
  let { url, sourceNodeId, onCreate }: Props = $props();

  const valid = $derived.by(() => {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  });
</script>

{#if valid}
  <button
    type="button"
    class="open-as-webpage"
    title="Open as webpage node"
    aria-label="Open as webpage node"
    onclick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onCreate({ url, fromNodeId: sourceNodeId });
    }}
  >
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.5 2 11.5 0 14M10 3c-2 2.5-2 11.5 0 14"/></svg>
  </button>
{/if}

<style>
  .open-as-webpage {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 4px;
    font-size: inherit;
    color: var(--text-muted);
    line-height: 1;
  }
  .open-as-webpage:hover {
    color: var(--accent);
  }
</style>
