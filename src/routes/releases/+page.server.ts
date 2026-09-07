import { getReleaseShowcase } from '$lib/releases/public';
import { getReleaseConsole, parseConsoleFilters, weeklyCadence } from '$lib/releases/console';
import { isOwnerRequest } from '$lib/server/owner';
import type { PageServerLoad } from './$types';

/**
 * The release record — one URL, two audiences.
 *
 * Signed out it is the public showcase: release-level counts, the cadence
 * chart, and only the capabilities `$lib/releases/public-filter` clears for
 * anonymous readers. Signed in it is the whole console that used to live at
 * /admin/ops/releases — every release, its commits and files, the summariser
 * queue and the regenerate controls.
 *
 * The split is enforced HERE, in the payload, exactly the way /health does it
 * (see that loader's note). An anonymous visitor is never sent the owner data
 * and then shown a narrower view of it: `{#if owner}` in a template still ships
 * the bytes to the browser, and the bytes are the disclosure. Raw commit prose
 * is precisely what put a personal phone number on the public internet on
 * 2026-07-29 — see $lib/releases/public-filter.
 *
 * Both branches are awaited and server-rendered: the point of the public half
 * is to be readable and indexable, so nothing on it may depend on client JS.
 */
export const load: PageServerLoad = async (event) => {
  const filters = parseConsoleFilters(event.url);

  if (await isOwnerRequest(event)) {
    return { mode: 'owner' as const, ...(await getReleaseConsole(filters)) };
  }

  const data = await getReleaseShowcase();

  // The public list stays COMPLETE — no paging. It is an archive meant to be
  // read straight through and indexed, and 300-odd short entries is one cheap
  // document; `page` is an owner-console concern, where a page carries 25
  // releases' worth of commits and files.
  const needle = filters.q.toLowerCase();
  const items = data.items.filter((i) => {
    if (filters.kind !== 'all' && i.kind !== filters.kind) return false;
    if (!needle) return true;
    return (
      i.title.toLowerCase().includes(needle) ||
      i.summary.toLowerCase().includes(needle) ||
      i.version.toLowerCase().includes(needle) ||
      i.surfaces.some((s) => s.toLowerCase().includes(needle))
    );
  });

  // Two different questions, so two different lists. The MIX describes what is
  // on the page, and narrows as you filter. The OPTIONS come from the whole
  // safe corpus, because deriving them from the filtered set would shrink the
  // picker to the choice you already made and trap you there — and they are the
  // corpus's kinds rather than all six, so the picker never offers `infra`,
  // whose items the public filter removes in their entirety.
  const mix = new Map<string, number>();
  for (const i of items) mix.set(i.kind, (mix.get(i.kind) ?? 0) + 1);

  return {
    mode: 'public' as const,
    totals: data.totals,
    cadence: weeklyCadence(data.cadence),
    kindMix: [...mix.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
    kindOptions: data.kindMix.map((k) => String(k.kind)),
    items,
    filters: { kind: filters.kind, q: filters.q },
  };
};
