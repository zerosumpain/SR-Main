import type { CapabilityEntry } from '../types';

// Not built yet. jkai says so when asked, links the page that does it today,
// and offers to commission it only on an attended owner turn (plan point 7,
// decision 5). Planned rows never reach the always-on prompt, the MCP
// essentials or the tool list; they surface only through jkai_help and
// tool_search. When a row's tools ship, flip it to live in the same PR —
// `manifest.test.ts` fails while a planned row names a registered tool.
//
// These are the gaps the 2026-10-28 overhaul audit found (point 2, P2-7 to
// P2-11): no demand recorded yet, so they are rows, not tools. The workflow
// knit (2026-11-11) shipped the family, games, Hometowns and notebook tools,
// so those rows are live in `owner.ts`; `people-location` is held by decision.

export const PLANNED_ENTRIES: CapabilityEntry[] = [
  {
    id: 'family-photos',
    title: 'Family photos, holds and the digest',
    blurb: 'The rest of the family side of the app from chat: family photos, holds and the family digest.',
    app: 'main',
    repo: 'SR-Main',
    status: 'planned',
    toolsets: [],
    tools: ['family_digest', 'family_photos'],
    keywords: [String.raw`\bfamily\s+(?:photos?|pictures?|digest|holds?)\b`],
    pages: ['/home'],
    native: 'family',
    memberSafe: false,
    notes: 'Use the phone app for family photos, holds and the digest; jkai cannot read or change them yet.',
  },
  {
    id: 'people-location',
    title: 'People and where they are',
    blurb: 'Who is who in the household and where family members are, from chat.',
    app: 'main',
    repo: 'SR-Main',
    status: 'planned',
    toolsets: [],
    tools: ['people_list', 'people_location'],
    keywords: [String.raw`\bwhere\s+is\s+\w+\b|\bwho(?:'s|\s+is)\s+home\b|\bfamily\s+(?:location|whereabouts)\b`],
    pages: ['/home/people'],
    memberSafe: false,
    notes: 'The most sensitive data the site holds; it stays out of chat until John asks for it.',
  },
  {
    id: 'wildmind',
    title: 'Wildmind',
    blurb: 'Wildmind from chat: the creatures, the world and what changed.',
    app: 'wildmind',
    repo: 'wildmind',
    status: 'planned',
    toolsets: [],
    tools: ['wildmind_status'],
    keywords: [String.raw`\bwildmind\b`],
    pages: ['/wildmind'],
    native: 'wildmind',
    memberSafe: false,
  },
];
