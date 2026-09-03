<script lang="ts">
  // Every Intel surface reaches every other one — through the header's menu
  // rather than through a nav strip of its own.
  //
  // Nine surfaces used to render as a horizontal row of tabs directly under the
  // hub header, which meant two navigations stacked on top of each other before
  // the page began, on every intel page. The information those tabs carried —
  // where a surface sits in the loop, how big its backlog is, and what question
  // it answers — is all still here; it is in the dropdown the header already
  // has, which costs no vertical space until it is asked for.
  //
  // The loop, and it is a loop:
  //   capture → triage → repair → explore → collect → act
  //
  // Counts come from the intel layout load (`intelCounts`), which is ten COUNT
  // queries and nothing else — a nav badge must never cost an analytics run.

  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';
  import { setPageMenu, clearPageMenu, type PageMenu } from '$lib/jkai/hub-bus.svelte';
  import { SURFACES, type IntelCounts } from '$lib/components/intel/workbench';
  import type { LayoutData } from './$types';

  let { children, data }: { children: Snippet; data: LayoutData } = $props();

  function badge(counts: IntelCounts, key: keyof IntelCounts | undefined): number | null {
    if (!key) return null;
    const value = counts?.[key];
    return typeof value === 'number' ? value : null;
  }

  const menu = $derived<PageMenu>({
    label: 'intel',
    // No `back` published. The hub header derives it from $lib/nav/site-nav
    // instead, which walks ONE level at a time — /jkai/intel/notes/9 goes to
    // /jkai/intel/notes, not straight out to the chat. Publishing a shortcut
    // here made this surface the one place on the site where "back" skipped
    // levels, which is the inconsistency the shared bar exists to remove.
    groups: [
      {
        heading: 'The loop',
        rows: SURFACES.map((s) => {
          const n = badge(data.intelCounts, s.count);
          return {
            label: s.label,
            href: s.href,
            // The stage marker is what turns nine links into one sequence, and
            // the count is what says which of them has a backlog. Both, because
            // dropping either was what made the old nav unreadable.
            meta: n === null ? s.stage : `${s.stage} · ${n}`,
            // Both halves of what the old nav's caption said: what this surface
            // answers, and when to reach for it INSTEAD of its neighbour. That
            // second sentence is the one nobody could reconstruct from a row of
            // nine equal tabs, so it stays.
            title: `${s.question}\n\n${s.ratherThan}`,
            warn: !!s.warnAbove && n !== null && n > s.warnAbove,
          };
        }),
      },
      {
        heading: 'Add',
        rows: [{ label: 'New note', href: '/jkai/intel/notes/new', meta: 'CAPTURE' }],
      },
      {
        heading: 'Hub',
        rows: [
          { label: 'Chat', href: '/jkai', meta: 'THREAD' },
          { label: 'Canvas', href: '/jkai/canvas', meta: 'WORKFLOWS' },
          { label: 'Research', href: '/research', meta: 'DEEP DIVE' },
          { label: 'Builds', href: '/jkai/builds', meta: 'AUTONOMOUS' },
        ],
      },
    ],
  });

  // Republished whenever the counts change, so a badge is never stale. Cleared
  // on the way out or the header would keep offering intel's nav on /jkai.
  $effect(() => {
    setPageMenu(menu);
  });

  onDestroy(() => clearPageMenu());
</script>

{@render children()}
