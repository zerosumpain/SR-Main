<script lang="ts">
  /**
   * The sources family publishes its own menu into the hub header, the way
   * Intel and Codegraph do: the chip reads `sources`, and the dropdown holds
   * the four surfaces personal data is spread across. `back` is deliberately
   * not published — $lib/nav/site-nav walks one level at a time.
   */
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';
  import { setPageMenu, clearPageMenu, type PageMenu } from '$lib/jkai/hub-bus.svelte';

  let { children }: { children: Snippet } = $props();

  const menu: PageMenu = {
    label: 'sources',
    groups: [
      {
        heading: 'Personal data',
        rows: [
          { label: 'Sources', href: '/jkai/sources', meta: 'CATALOGUE', title: 'Connected accounts, archives and the guided setup' },
          { label: 'Activity', href: '/jkai/activity', meta: 'EVIDENCE', title: 'What each source actually supplied, with provenance' },
          { label: 'Data access', href: '/jkai/settings/data-access', meta: 'PERMISSIONS', title: 'Which consumer may read which class of data' },
        ],
      },
      {
        heading: 'Hub',
        rows: [{ label: 'Chat', href: '/jkai', meta: 'THREAD' }],
      },
    ],
  };

  $effect(() => {
    setPageMenu(menu);
  });

  onDestroy(() => clearPageMenu());
</script>

{@render children()}
