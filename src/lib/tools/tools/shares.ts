// src/lib/tools/tools/shares.ts
//
// jkai's share-link read (workflow knit 2026-11-11, slice 3).
//
//   share_links   the share links of the project pages, with how each was used
//
// A read over `listSharesWithVisits`, which never selects the token hash or
// the password verifier. What leaves here is narrower still: the label, the
// dates, whether it asks for a password, and COUNTS of opens, browsers and
// networks. The visitor rows (which carry a network and a browser each) stay
// on the page, and a link's token is never stored in a readable form at all.
// Creating or revoking a link and setting its password are NOT tools: they
// stay on the page, by decision.
//
// Owner-only, not member-safe. Registered through the registry
// (src/lib/tools/registry.ts imports this module).

import { register } from '../registry-internal';
import { refuseUnlessOwner } from './owner-only';
import { getAllowedProjectKeys } from '$lib/projects/registry';
import { listSharesWithVisits, type SharedLink } from '$lib/projects/shares';

const iso = (d: Date | null | undefined): string | null => (d instanceof Date ? d.toISOString() : null);

/** One link as a reply may carry it: counts and dates, no visitor rows. PURE. */
export function shareRow(s: SharedLink, now = Date.now()) {
  const state = s.revokedAt ? 'revoked' : s.expiresAt && s.expiresAt.getTime() <= now ? 'expired' : 'live';
  return {
    id: s.id,
    label: s.label,
    state,
    createdAt: iso(s.createdAt),
    expiresAt: iso(s.expiresAt),
    lastUsedAt: iso(s.lastUsedAt),
    asksForPassword: s.hasPassword,
    pack: s.pack,
    opens: s.opens,
    browsers: s.browsers,
    networks: s.networks,
    countries: s.countries.slice(0, 8),
    likelyForwarded: s.likelyForwarded,
  };
}

register({
  name: 'share_links',
  description:
    "The share links John made for his project pages: each link's label, whether it is live, expired or revoked, when it was last used, and how many times, browsers and networks opened it. For \"has anyone opened the link I sent\", \"which links are still live\". Never the link itself or its password. Creating and revoking links is done on the project's page. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Optional project key. Default every project that has a link.' },
      live_only: { type: 'boolean', description: 'Only links that still work. Default false.' },
    },
    required: [],
  },
  category: 'Projects',
  toolset: 'shares',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('share_links', ctx);
    if (refused) return refused;
    const keys = [...(await getAllowedProjectKeys())].sort();
    const asked = typeof args.project === 'string' ? args.project.trim() : '';
    if (asked && !keys.includes(asked)) return { success: false, error: `No project "${asked.slice(0, 60)}". Projects: ${keys.slice(0, 30).join(', ')}.` };
    try {
      const now = Date.now();
      const projects: Array<{ project: string; links: ReturnType<typeof shareRow>[] }> = [];
      for (const key of asked ? [asked] : keys) {
        const links = (await listSharesWithVisits(key)).map((s) => shareRow(s, now)).filter((l) => args.live_only !== true || l.state === 'live');
        if (links.length) projects.push({ project: key, links: links.slice(0, 25) });
      }
      return { success: true, data: { projects, message: projects.length ? undefined : 'No share link matched.' } };
    } catch (err) {
      return { success: false, error: `share_links could not be read: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
    }
  },
});
