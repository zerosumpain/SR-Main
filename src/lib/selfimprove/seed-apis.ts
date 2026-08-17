// src/lib/selfimprove/seed-apis.ts
//
// Idempotent boot seeds for the self-improvement engine:
//   - the three system collections (create-if-absent, never clobbered),
//   - ~12 known-good public APIs into `api_catalog` (only where the key is
//     ABSENT — a self-registered entry with the same key is never overwritten).
//
// Seeding runs on every boot, before the engine's own prod gate (see
// engine.ts) — that is deliberate, the collections are needed whether or not
// the nightly run ever fires.
//
// The ONE exception is the API catalogue. A host that sets
// API_REGISTRY_DISABLED=1 holds no registry at all, and without a gate here
// the ~12 seed entries and the collection shell come back on the next
// restart, silently undoing a purge. See $lib/apis/registry-enabled for why
// homeserv is such a host.

import {
  DatastoreError,
  ensureCollection,
  getRecordByKey,
  upsertRecord,
} from '$lib/datastore';
import { slugifyName } from '$lib/workflows/site-tools/tools/apis';
import { apiRegistryDisabled } from '$lib/apis/registry-enabled';
import { ensureToolPolicyCollection } from '$lib/toolpolicy/policy';
import { COLLECTIONS, SYSTEM_ACTOR, SYSTEM_PERMISSIONS, errMsg, type SeedApiEntry } from './types';

/** ~12 public data APIs already used across the site (and a few obvious extras). */
export const SEEDED_APIS: SeedApiEntry[] = [
  {
    name: 'Explore Education Statistics (EES)',
    baseUrl: 'https://api.explore-education-statistics.service.gov.uk/api/v1',
    docsUrl: 'https://dev.explore-education-statistics.service.gov.uk/api-docs/',
    description: 'Official DfE statistics API — publications, data sets and queryable statistical data for England education.',
    capabilities: ['education statistics', 'pupil numbers', 'schools data', 'DfE datasets'],
    tags: ['education', 'dfe', 'statistics', 'uk', 'gov'],
    auth: { kind: 'none' },
    exampleRequests: [
      { label: 'List publications', method: 'GET', url: 'https://api.explore-education-statistics.service.gov.uk/api/v1/publications' },
    ],
  },
  {
    name: 'Get Information About Schools (GIAS)',
    baseUrl: 'https://ea-edubase-api-prod.azurewebsites.net',
    docsUrl: 'https://get-information-schools.service.gov.uk/',
    description: 'DfE register of schools, colleges and other educational establishments in England (bulk downloads + establishment lookup).',
    capabilities: ['school lookup', 'establishment register', 'URN lookup', 'school details'],
    tags: ['education', 'dfe', 'schools', 'uk', 'gov'],
    auth: { kind: 'none' },
    exampleRequests: [
      { label: 'Public bulk downloads index', method: 'GET', url: 'https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/' },
    ],
  },
  {
    name: 'ONS Beta API',
    baseUrl: 'https://api.beta.ons.gov.uk/v1',
    docsUrl: 'https://developer.ons.gov.uk/',
    description: 'Office for National Statistics API — datasets, timeseries and observations for UK population, economy and society.',
    capabilities: ['population', 'economy', 'census', 'inflation', 'timeseries'],
    tags: ['statistics', 'ons', 'uk', 'gov', 'economy'],
    auth: { kind: 'none' },
    exampleRequests: [
      { label: 'List datasets', method: 'GET', url: 'https://api.beta.ons.gov.uk/v1/datasets' },
    ],
  },
  {
    name: 'World Bank Indicators',
    baseUrl: 'https://api.worldbank.org/v2',
    docsUrl: 'https://datahelpdesk.worldbank.org/knowledgebase/articles/889392',
    description: 'World Bank open data — development indicators by country (population, GDP, education spend, etc.).',
    capabilities: ['country indicators', 'GDP', 'population', 'development data'],
    tags: ['economy', 'global', 'development', 'statistics'],
    auth: { kind: 'none' },
    exampleRequests: [
      { label: 'UK total population', method: 'GET', url: 'https://api.worldbank.org/v2/country/GB/indicator/SP.POP.TOTL?format=json' },
    ],
  },
  {
    name: 'GOV.UK Search & Content API',
    baseUrl: 'https://www.gov.uk/api',
    docsUrl: 'https://content-api.publishing.service.gov.uk/',
    description: 'GOV.UK content + search API — canonical published guidance, registers and policy content.',
    capabilities: ['gov guidance', 'policy content', 'gov search', 'registers'],
    tags: ['gov', 'uk', 'registers', 'content'],
    auth: { kind: 'none' },
    exampleRequests: [
      { label: 'Search GOV.UK', method: 'GET', url: 'https://www.gov.uk/api/search.json?q=school%20funding&count=5' },
      { label: 'Content item', method: 'GET', url: 'https://www.gov.uk/api/content/vat-rates' },
    ],
  },
  {
    name: 'Police UK Data',
    baseUrl: 'https://data.police.uk/api',
    docsUrl: 'https://data.police.uk/docs/',
    description: 'Open policing data for England, Wales and Northern Ireland — street-level crime, outcomes and neighbourhood teams.',
    capabilities: ['crime data', 'street crime', 'neighbourhood policing'],
    tags: ['crime', 'police', 'uk', 'gov'],
    auth: { kind: 'none' },
    exampleRequests: [
      { label: 'Available data', method: 'GET', url: 'https://data.police.uk/api/crimes-street-dates' },
      { label: 'Street crime by point', method: 'GET', url: 'https://data.police.uk/api/crimes-street/all-crime?lat=52.629&lng=-1.132&date=2024-01' },
    ],
  },
  {
    name: 'Open-Meteo',
    baseUrl: 'https://api.open-meteo.com/v1',
    docsUrl: 'https://open-meteo.com/en/docs',
    description: 'Free weather forecast API — current conditions and hourly/daily forecasts by lat/lng, no key required.',
    capabilities: ['weather', 'forecast', 'temperature', 'precipitation'],
    tags: ['weather', 'forecast', 'global'],
    auth: { kind: 'none' },
    exampleRequests: [
      { label: 'Current weather (London)', method: 'GET', url: 'https://api.open-meteo.com/v1/forecast?latitude=51.51&longitude=-0.13&current_weather=true' },
    ],
  },
  {
    name: 'Wikipedia REST API',
    baseUrl: 'https://en.wikipedia.org/api/rest_v1',
    docsUrl: 'https://en.wikipedia.org/api/rest_v1/',
    description: 'Wikipedia REST API — page summaries, extracts and metadata for general-knowledge lookups.',
    capabilities: ['encyclopedia', 'page summary', 'general knowledge', 'definitions'],
    tags: ['knowledge', 'reference', 'wiki'],
    auth: { kind: 'none' },
    exampleRequests: [
      { label: 'Page summary', method: 'GET', url: 'https://en.wikipedia.org/api/rest_v1/page/summary/Department_for_Education' },
    ],
  },
  {
    name: 'Wikidata SPARQL',
    baseUrl: 'https://query.wikidata.org',
    docsUrl: 'https://query.wikidata.org/',
    description: 'Wikidata query service — structured facts over a global knowledge graph via SPARQL (JSON results).',
    capabilities: ['structured facts', 'entities', 'knowledge graph', 'sparql'],
    tags: ['knowledge', 'reference', 'wikidata', 'sparql'],
    auth: { kind: 'none' },
    exampleRequests: [
      {
        label: 'Simple SPARQL (JSON)',
        method: 'GET',
        url: 'https://query.wikidata.org/sparql?format=json&query=SELECT%20%3Fitem%20WHERE%20%7B%20%3Fitem%20wdt%3AP31%20wd%3AQ3918%20%7D%20LIMIT%205',
      },
    ],
  },
  {
    name: 'TfL Unified API',
    baseUrl: 'https://api.tfl.gov.uk',
    docsUrl: 'https://api-portal.tfl.gov.uk/',
    description: 'Transport for London unified API — line status, journey planning, stops and arrivals (app key optional for higher limits).',
    capabilities: ['transport', 'tube status', 'journey planning', 'london travel'],
    tags: ['transport', 'london', 'tfl', 'uk'],
    auth: { kind: 'none' },
    exampleRequests: [
      { label: 'Victoria line status', method: 'GET', url: 'https://api.tfl.gov.uk/Line/victoria/Status' },
    ],
  },
  {
    name: 'Companies House',
    baseUrl: 'https://api.company-information.service.gov.uk',
    docsUrl: 'https://developer.company-information.service.gov.uk/',
    description: 'UK company register — company profiles, officers and filing history. Requires an API key.',
    capabilities: ['company lookup', 'company registration', 'officers', 'filing history'],
    tags: ['companies', 'uk', 'gov', 'registration'],
    auth: { kind: 'bearer-env', envVar: 'COMPANIES_HOUSE_API_KEY' },
    exampleRequests: [
      { label: 'Company profile', method: 'GET', url: 'https://api.company-information.service.gov.uk/company/00000006' },
    ],
  },
  {
    name: 'OpenRouter Models',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/docs',
    description: 'OpenRouter models catalogue — live list of available LLMs with pricing and context lengths.',
    capabilities: ['llm catalogue', 'model pricing', 'model list'],
    tags: ['llm', 'ai', 'models', 'pricing'],
    auth: { kind: 'none' },
    exampleRequests: [
      { label: 'List models', method: 'GET', url: 'https://openrouter.ai/api/v1/models' },
    ],
  },
  {
    // Not to be confused with OpenRouter above — openrouteservice is a routing
    // engine, nothing to do with LLMs. Prefer the `route_plan` tool over a raw
    // api_call: the tool adds the loop-quality scoring that turns a raw ORS
    // round_trip into a route worth running.
    name: 'openrouteservice (ORS)',
    baseUrl: 'https://api.openrouteservice.org',
    docsUrl: 'https://openrouteservice.org/dev/#/api-docs',
    description:
      'OpenStreetMap routing engine — directions, round trips, isochrones and elevation for running, road cycling, mountain biking and hiking. Returns surface, waytype and steepness breakdowns alongside the geometry. Free tier: 2,500 requests/day, 40/minute; round-trip and alternative routes are capped at 100 km.',
    capabilities: [
      'route planning',
      'running routes',
      'cycling routes',
      'mountain bike routes',
      'hiking routes',
      'circular routes',
      'round trip',
      'elevation profile',
      'surface and terrain',
      'isochrones',
      'geocoding',
    ],
    tags: ['routing', 'maps', 'osm', 'gpx', 'running', 'cycling', 'mtb', 'hiking'],
    auth: { kind: 'header-env', envVar: 'ORS_API_KEY', header: 'Authorization' },
    exampleRequests: [
      {
        label: 'Circular running route, ~10 km from a start point',
        method: 'POST',
        url: 'https://api.openrouteservice.org/v2/directions/foot-hiking/geojson',
        body: {
          coordinates: [[-1.5023, 53.4012]],
          options: { round_trip: { length: 10000, points: 5, seed: 1 } },
          elevation: true,
          extra_info: ['surface', 'waytype', 'steepness'],
        },
      },
      {
        label: 'Mountain-bike route between two points, with terrain breakdown',
        method: 'POST',
        url: 'https://api.openrouteservice.org/v2/directions/cycling-mountain/geojson',
        body: {
          coordinates: [
            [-1.5023, 53.4012],
            [-1.4712, 53.3688],
          ],
          elevation: true,
          extra_info: ['surface', 'waytype', 'steepness'],
        },
      },
    ],
  },
];

/**
 * Create the three system collections if absent. Idempotent — `ensureCollection`
 * returns the existing collection unchanged, so existing metadata is preserved.
 */
export async function ensureSystemCollections(): Promise<void> {
  // The tool-call policy collection is owned by $lib/toolpolicy (the MCP read
  // path needs it whether or not the engine has ever run), so it seeds itself.
  await ensureToolPolicyCollection();

  // The catalogue is the only registry-owned collection in this list; the rest
  // are engine bookkeeping and are wanted on every host. A host that holds no
  // registry skips just this one. See $lib/apis/registry-enabled.
  if (!apiRegistryDisabled()) {
    await ensureCollection(
      COLLECTIONS.apiCatalog,
      {
        name: 'API Catalogue',
        description: 'Catalogued external data sources for API-first answering (api_search / api_call / api_register).',
        isSystem: true,
        defaultPermissions: SYSTEM_PERMISSIONS.api_catalog,
      },
      SYSTEM_ACTOR,
    );
  }
  await ensureCollection(
    COLLECTIONS.questionInsights,
    {
      name: 'Question Insights',
      description: 'Nightly-maintained analysis of the questions the user asks — intents, coverage, and unmet needs.',
      isSystem: true,
      defaultPermissions: SYSTEM_PERMISSIONS.question_insights,
    },
    SYSTEM_ACTOR,
  );
  await ensureCollection(
    COLLECTIONS.improvementRuns,
    {
      name: 'Improvement Runs',
      description: 'One record per nightly self-improvement run (status, phases, budget, actions, report).',
      isSystem: true,
      defaultPermissions: SYSTEM_PERMISSIONS.improvement_runs,
    },
    SYSTEM_ACTOR,
  );
  await ensureCollection(
    COLLECTIONS.toolAttempts,
    {
      name: 'Tool Attempts',
      description: 'Every runtime tool the engine tried to build — created AND rejected — with the generated code and failure reason.',
      isSystem: true,
      defaultPermissions: SYSTEM_PERMISSIONS.tool_attempts,
    },
    SYSTEM_ACTOR,
  );
  await ensureCollection(
    COLLECTIONS.backlog,
    {
      name: 'Improvement Backlog',
      description:
        'Durable queue of ideas the engine intends to build, with attempt counts and last failure — its memory between nights.',
      isSystem: true,
      defaultPermissions: SYSTEM_PERMISSIONS.improvement_backlog,
    },
    SYSTEM_ACTOR,
  );
}

/**
 * Upsert the seed APIs, but ONLY where the key is not already present — never
 * clobber a self-registered / verified entry. Returns counts for logging/tests.
 */
export async function seedApiCatalog(): Promise<{ seeded: number; skipped: number }> {
  // Nothing to seed on a host that holds no registry — and without this the
  // ~12 seed entries reappear on the next boot, silently undoing a purge.
  if (apiRegistryDisabled()) return { seeded: 0, skipped: 0 };

  let seeded = 0;
  let skipped = 0;
  for (const entry of SEEDED_APIS) {
    const key = slugifyName(entry.name);
    let exists = false;
    try {
      await getRecordByKey(COLLECTIONS.apiCatalog, key, SYSTEM_ACTOR);
      exists = true;
    } catch (err) {
      if (!(err instanceof DatastoreError && err.code === 'not_found')) throw err;
    }
    if (exists) {
      skipped++;
      continue;
    }
    await upsertRecord(
      COLLECTIONS.apiCatalog,
      {
        key,
        data: { ...entry, status: 'seeded', source: 'seed', lastVerifiedAt: undefined },
      },
      SYSTEM_ACTOR,
    );
    seeded++;
  }
  return { seeded, skipped };
}

/** Run every boot seed (collections first, then the catalogue). */
export async function runSeeds(): Promise<{ seeded: number; skipped: number }> {
  await ensureSystemCollections();
  try {
    return await seedApiCatalog();
  } catch (err) {
    console.error('[selfimprove] api catalogue seed failed:', errMsg(err));
    return { seeded: 0, skipped: 0 };
  }
}
