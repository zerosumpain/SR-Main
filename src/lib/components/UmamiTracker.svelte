<script lang="ts">
  import { env } from '$env/dynamic/public';
  const siteId = env.PUBLIC_UMAMI_SITE_ID;
  const scriptUrl = env.PUBLIC_UMAMI_SCRIPT_URL;
</script>

{#if siteId && scriptUrl}
  <svelte:head>
    <script async defer data-website-id={siteId} src={scriptUrl}></script>
  </svelte:head>
{/if}
