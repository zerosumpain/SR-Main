<script lang="ts">
  import BuildDetailV2 from '$lib/builds/BuildDetailV2.svelte';
  import BuildSession from '$lib/builds/BuildSession.svelte';

  let { data } = $props();

</script>

{#if data?.workspaceHref}
  <p class="bd-signpost">
    This build is a site development feature. The brief, its preview and its
    acceptance evidence live in the workspace.
    <a href={data.workspaceHref}>Open the development workspace →</a>
  </p>
{/if}

{#if data?.v3}
  <BuildSession {data} />
{:else}
  <BuildDetailV2 {data} />
{/if}

<style>
  /* A thin band above the console, in the jkai admin register the rest of this
     page uses — not the daydream one, which belongs to /jkai/develop. */
  .bd-signpost {
    margin: 0;
    padding: 11px clamp(14px, 2vw, 22px);
    border-bottom: 1px solid var(--line);
    background: var(--surface-sunken);
    font-size: var(--fs-nav);
    color: var(--text-secondary);
  }
  .bd-signpost a {
    color: var(--accent-ink);
    white-space: nowrap;
  }
</style>
