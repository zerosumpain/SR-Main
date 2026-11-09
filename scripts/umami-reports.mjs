#!/usr/bin/env node
/**
 * Saved Umami reports for share-link analytics: goals, funnels and a segment.
 * Idempotent by name: anything already there is left alone, so re-run it
 * whenever a project is added (PROJECTS below).
 *
 *   UMAMI_API_BASE=http://127.0.0.1:3002 UMAMI_USERNAME=… UMAMI_PASSWORD=… \
 *   UMAMI_WEBSITE_ID=… node scripts/umami-reports.mjs [--dry-run]
 *
 * The events it relies on come from the trackers: `share-open` and `engaged`
 * ($lib/analytics/project-tracker, injected by the project gateways),
 * `outbound-link`, `download`, `http-error`, `blog-read-complete`
 * (UmamiTracker). Every project event carries `project`, and a share visit's
 * also `link` ("label · id"), so a funnel can be narrowed to one project.
 */

/** Project key → name, for the per-project funnels. Keys as Main's PROJECT_AUDIENCES. */
const PROJECTS = {
  'local-plan-navigator': 'Local Plan Navigator',
  'supply-chain-monitor': 'Supply Chain Monitor',
  spine: 'Spine',
  'data-spine': 'Data Spine',
  'dfe-data-strategy': 'DfE Data Strategy',
  'policy-engine': 'Policy Engine',
  'data-standard-designer': 'Data Standard Designer',
  wildmind: 'Wildmind',
  casebook: 'Casebook',
};

const DAY = 24 * 60;
const event = (value, project) => ({
  type: 'event',
  value,
  ...(project ? { filters: [{ property: 'project', operator: 'eq', value: project }] } : {}),
});

const GOALS = [
  ['Share link opened', 'share-open'],
  ['Engaged (30 s on a page)', 'engaged'],
  ['Outbound link followed', 'outbound-link'],
  ['File downloaded', 'download'],
  ['Blog post read to the end', 'blog-read-complete'],
  ['Error page shown', 'http-error'],
].map(([name, value]) => ({ name, parameters: { type: 'event', value } }));

const FUNNELS = [
  {
    name: 'Shared links: opened → engaged → followed a link out',
    description: 'Every project, every share link. Narrow by link with the event filter on `link`.',
    parameters: { window: DAY, steps: [event('share-open'), event('engaged'), event('outbound-link')] },
  },
  ...Object.entries(PROJECTS).map(([key, title]) => ({
    name: `${title} via share link: opened → engaged`,
    description: `Visits that came in on a ${title} share link and stayed 30 s on a page.`,
    parameters: { window: DAY, steps: [event('share-open', key), event('engaged', key)] },
  })),
];

const SEGMENTS = [
  {
    type: 'segment',
    name: 'Share-link visitors',
    parameters: { sessionPropertyFilters: [{ propertyName: 'access', dataType: 1, operator: 'eq', value: 'share' }] },
  },
  {
    type: 'segment',
    name: 'Owner (me)',
    parameters: {
      match: 'any',
      sessionPropertyFilters: [
        { propertyName: 'role', dataType: 1, operator: 'eq', value: 'owner' },
        { propertyName: 'access', dataType: 1, operator: 'eq', value: 'owner' },
      ],
    },
  },
];

const { UMAMI_API_BASE: base, UMAMI_USERNAME: username, UMAMI_PASSWORD: password, UMAMI_WEBSITE_ID: site } = process.env;
const dry = process.argv.includes('--dry-run');
if (!base || !username || !password || !site) {
  console.error('Set UMAMI_API_BASE, UMAMI_USERNAME, UMAMI_PASSWORD and UMAMI_WEBSITE_ID.');
  process.exit(2);
}

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
if (!login.ok) throw new Error(`Umami login failed: ${login.status}`);
const { token } = await login.json();
const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
};
const names = (list) => new Set((Array.isArray(list) ? list : (list?.data ?? [])).map((r) => r.name));

async function ensure(kind, items, listPath, createPath) {
  const have = names(await api('GET', `${listPath}${listPath.includes('?') ? '&' : '?'}pageSize=500`));
  for (const item of items) {
    if (have.has(item.name)) {
      console.log(`  ${kind}: "${item.name}" exists`);
      continue;
    }
    if (!dry) await api('POST', createPath, item);
    console.log(`  ${kind}: "${item.name}" ${dry ? 'would be created' : 'created'}`);
  }
}

console.log(`Umami reports for website ${site}${dry ? ' (dry run)' : ''}`);
await ensure('goal', GOALS, `/api/websites/${site}/goals`, `/api/websites/${site}/goals`);
await ensure('funnel', FUNNELS, `/api/websites/${site}/funnels`, `/api/websites/${site}/funnels`);
await ensure('segment', SEGMENTS, `/api/websites/${site}/segments?type=segment`, `/api/websites/${site}/segments`);
