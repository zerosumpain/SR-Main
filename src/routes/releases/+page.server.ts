import { SOURCE_FOOTPRINT } from 'virtual:sr-source-footprint';
import { getReleaseShowcase } from '$lib/releases/public';
import { getReleaseConsole, monthlyReleaseBuckets, parseConsoleFilters, weeklyCadence } from '$lib/releases/console';
import { isOwnerRequest } from '$lib/server/owner';
import { getReleaseSessions } from '$lib/releases/sessions.server';
import { withPrivateFootprint } from '$lib/releases/private-footprint.server';
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
  const today = new Date().toISOString().slice(0, 10);

  if (await isOwnerRequest(event)) {
    const console_ = await getReleaseConsole(filters);
    // Sessions for the releases on THIS page, joined on PR number. The owner
    // log groups them with those releases, so there is only one pager.
    //
    // Fetched inside the owner branch, never outside it. The public payload must
    // not carry session prose, prompts or per-stage costs at all — shipping the
    // bytes and hiding them behind {#if owner} is the disclosure this page's
    // whole design exists to prevent.
    const sessions = await getReleaseSessions(console_.items.map((i) => i.id));
    return {
      sourceFootprint: withPrivateFootprint(SOURCE_FOOTPRINT),
      mode: 'owner' as const,
      ...console_,
      sessions,
      today,
      sampleData: process.env.SHIPPED_PREVIEW_SAMPLE_DATA === '1',
    };
  }

  const data = await getReleaseShowcase();

  // The public list stays COMPLETE — no paging. It is an archive meant to be
  // read straight through and indexed, and 300-odd short entries is one cheap
  // document; `page` is an owner-console concern, where a page carries 25
  // releases' worth of commits and files.
  const needle = filters.q.toLowerCase();
  const items = data.items.filter((i) => {
    if (filters.kind !== 'all' && i.kind !== filters.kind) return false;
    const day = i.deployedAt.slice(0, 10);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
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
    // External service repositories are private. Keep their names and sizes
    // out of the anonymous payload, while showing the public SR-Main source.
    sourceFootprint: {
      ...SOURCE_FOOTPRINT,
      lines: SOURCE_FOOTPRINT.repositories[0].code.lines,
      files: SOURCE_FOOTPRINT.repositories[0].code.files,
      categories: {
        code: SOURCE_FOOTPRINT.repositories[0].code,
        documentation: SOURCE_FOOTPRINT.repositories[0].documentation,
        tests: SOURCE_FOOTPRINT.repositories[0].tests,
      },
      repositories: [],
      snapshotAt: null,
    },
    today,
    totals: data.totals,
    cadence: weeklyCadence(data.cadence.filter((day) =>
      (!filters.from || day.date >= filters.from) && (!filters.to || day.date <= filters.to))),
    timeBuckets: monthlyReleaseBuckets(data.cadence),
    kindMix: [...mix.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
    kindOptions: data.kindMix.map((k) => String(k.kind)),
    items,
    filters: { kind: filters.kind, q: filters.q, from: filters.from, to: filters.to },
  };
};
