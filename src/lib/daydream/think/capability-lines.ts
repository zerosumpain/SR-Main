// src/lib/daydream/think/capability-lines.ts
//
// What the site can already do, and what is already on the build list, as
// the think prompt carries them. PURE.
//
// Before this, the loop was never told either. In October it proposed "build a
// trip-confirmation finder" five times in a fortnight while /trips did exactly
// that, and none of its 74 build notes was accepted. The manifest
// (`$lib/capabilities`) is the one list of what exists; the open backlog is
// passed in by the think activity (daydream cannot import the backlog — the
// module cycle `queueBuildNotes` documents).

import { CAPABILITIES } from '$lib/capabilities/manifest';

/** Pages a solution may open: every live or preview row's pages. */
export function sitePages(): Set<string> {
  const out = new Set<string>();
  for (const c of CAPABILITIES) if (c.status !== 'planned') for (const p of c.pages) out.add(p);
  // Daydream's own rooms, which the manifest does not list one by one.
  for (const p of ['/jkai/daydreams', '/jkai/daydreams/watches', '/jkai/daydreams/solutions']) out.add(p);
  return out;
}

/** "Trips — /trips: Plan a trip …" for each live or preview row with a page. */
export function capabilityLines(limit = 60): string[] {
  return CAPABILITIES.filter((c) => c.status !== 'planned' && c.pages.length)
    .slice(0, limit)
    .map((c) => `  - ${c.title} — ${c.pages[0]}${c.status === 'preview' ? ' (preview)' : ''}: ${c.blurb.replace(/\s+/g, ' ').slice(0, 110)}`);
}

/** The prompt block. `backlog` is open backlog titles, newest first. */
export function siteBlock(backlog: readonly string[]): string[] {
  return [
    'WHAT THE SITE ALREADY DOES — never propose building one of these; point him at its page with an "open" solution:',
    ...capabilityLines(),
    ...(backlog.length
      ? ['ALREADY ON THE BUILD LIST — do not propose these again; a note that would only repeat one is not worth writing:', ...backlog.slice(0, 25).map((t) => `  - ${t.replace(/\s+/g, ' ').slice(0, 100)}`)]
      : []),
  ];
}
