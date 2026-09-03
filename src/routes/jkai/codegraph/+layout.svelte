<script lang="ts">
  // Every Codegraph surface reaches every other through the header's menu,
  // exactly as Intel does — one nav idiom for both graphs, and no horizontal
  // tab strip stealing vertical space above every page.
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';
  import { setPageMenu, clearPageMenu, type PageMenu } from '$lib/jkai/hub-bus.svelte';
  import { SURFACES, type CodegraphCounts } from '$lib/components/codegraph/workbench';
  import type { LayoutData } from './$types';

  let { children, data }: { children: Snippet; data: LayoutData } = $props();

  function badge(counts: CodegraphCounts, key: keyof CodegraphCounts | undefined): number | null {
    if (!key) return null;
    const value = counts?.[key];
    return typeof value === 'number' ? value : null;
  }

  const menu = $derived<PageMenu>({
    label: 'codegraph',
    // No `back` published. The hub header derives it from $lib/nav/site-nav
    // instead, which walks ONE level at a time — /jkai/codegraph/ask goes to
    // /jkai/codegraph, not straight out to the chat. Publishing a shortcut
    // here made this surface the one place on the site where "back" skipped
    // levels, which is the inconsistency the shared bar exists to remove.
    groups: [
      {
        heading: 'The loop',
        rows: SURFACES.map((s) => {
          const n = badge(data.codegraphCounts, s.count);
          return {
            label: s.label,
            href: s.href,
            meta: n === null ? s.stage : `${s.stage} · ${n}`,
            title: `${s.question}\n\n${s.ratherThan}`,
            warn: !!s.warnAbove && n !== null && n > s.warnAbove,
          };
        }),
      },
      {
        heading: 'Hub',
        rows: [
          { label: 'Chat', href: '/jkai', meta: 'THREAD' },
          { label: 'Intel', href: '/jkai/intel', meta: 'THE WORLD' },
          { label: 'Builds', href: '/jkai/builds', meta: 'AUTONOMOUS' },
        ],
      },
    ],
  });

  $effect(() => {
    setPageMenu(menu);
  });
  onDestroy(() => clearPageMenu());
</script>

{@render children()}
