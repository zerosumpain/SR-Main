<script lang="ts">
  import { env } from '$env/dynamic/public';
  const siteId = env.PUBLIC_UMAMI_SITE_ID;
  const scriptUrl = env.PUBLIC_UMAMI_SCRIPT_URL;
</script>

<svelte:head>
  {#if siteId && scriptUrl}
    <script async defer data-website-id={siteId} src={scriptUrl}></script>
  {/if}
</svelte:head>
