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
    🌐
  </button>
{/if}

<style>
  .open-as-webpage {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 4px;
    font-size: inherit;
    color: var(--fg-2, #a0a0a0);
    line-height: 1;
  }
  .open-as-webpage:hover {
    color: var(--accent, #7aa2f7);
  }
</style>
