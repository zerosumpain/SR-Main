// Server-only: the live data sources for the signals strip + the EES publications feed.
// Each endpoint was probed by hand (June 2026) and works server-side with no key/auth.
// Every source carries a baked snapshot so a dead upstream never breaks the page.

import type { Publication, ResolvedStat } from './types';

type Fetch = typeof fetch;

async function getJson(f: Fetch, url: string, init?: RequestInit): Promise<any> {
  const res = await f(url, init);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const gb = (n: number) => n.toLocaleString('en-GB');

export interface LiveSource {
  id: string;
  label: string;
  source: string;
  sourceUrl: string;
  api: string;
  apiUrl: string;
  snapshot: number;
  snapshotDetail?: string;
  asOf: string;
  resolve: (f: Fetch) => Promise<{ value: number; detail?: string }>;
}

// EES "Schools, pupils and their characteristics" → number of schools / pupils.
// The query ANDs every filter column to its Total option for the latest academic year.
const EES_SCHOOLS_DATASET = '019e7444-74bf-776b-ac5d-77b929ebfcba';
const EES_SCHOOLS_QUERY = {
  criteria: {
    and: [
      { filters: { eq: 'zecxF' } }, // pupil first language → English (no Total option; count is language-invariant)
      { filters: { eq: 'mcbF9' } }, // admissions policy → Total
      { filters: { eq: '93EK4' } }, // school type (detailed) → Total
      { filters: { eq: 'PLDJe' } }, // urban/rural → Total
      { filters: { eq: 'yKGha' } }, // academy indicator → Total
      { filters: { eq: 'BVy27' } }, // denomination → Total
      { filters: { eq: 'UZqeR' } }, // school type → Total
      { filters: { eq: '0yriT' } }, // sex of school → Total
      { timePeriods: { eq: { code: 'AY', period: '2025/2026' } } },
      { geographicLevels: { eq: 'NAT' } }
    ]
  },
  indicators: ['0eJOT', 'mU5X9'], // 0eJOT = number of schools, mU5X9 = number of pupils
  page: 1,
  pageSize: 1
};

export const LIVE_SOURCES: LiveSource[] = [
  {
    id: 'vacancies',
    label: 'Teaching vacancies open now',
    source: 'Teaching Vacancies',
    sourceUrl: 'https://teaching-vacancies.service.gov.uk/',
    api: 'REST · /api/v1/jobs.json',
    apiUrl: 'https://teaching-vacancies.service.gov.uk/api/v1/jobs.json',
    snapshot: 6576,
    asOf: '2026-06-06',
    resolve: async (f) => {
      const d = await getJson(f, 'https://teaching-vacancies.service.gov.uk/api/v1/jobs.json?page=1');
      const top = d?.data?.[0];
      const loc = top?.jobLocation?.address?.addressLocality;
      return {
        value: Number(d?.meta?.count),
        detail: top?.title ? `latest: ${top.title}${loc ? ` · ${loc}` : ''}` : undefined
      };
    }
  },
  {
    id: 'itt',
    label: 'ITT courses, 2026 cycle',
    source: 'Find postgraduate teacher training',
    sourceUrl: 'https://find-teacher-training-courses.service.gov.uk/',
    api: 'REST · Teacher Training API',
    apiUrl:
      'https://api.publish-teacher-training-courses.service.gov.uk/api/public/v1/recruitment_cycles/2026/courses',
    snapshot: 14798,
    snapshotDetail: 'across 810 providers',
    asOf: '2026-06-06',
    resolve: async (f) => {
      const c = await getJson(
        f,
        'https://api.publish-teacher-training-courses.service.gov.uk/api/public/v1/recruitment_cycles/2026/courses?page%5Bper_page%5D=1'
      );
      let providers: number | undefined;
      try {
        const p = await getJson(
          f,
          'https://api.publish-teacher-training-courses.service.gov.uk/api/public/v1/recruitment_cycles/2026/providers?page%5Bper_page%5D=1'
        );
        providers = Number(p?.meta?.count);
      } catch {
        /* providers detail is optional */
      }
      return {
        value: Number(c?.meta?.count),
        detail: providers ? `across ${gb(providers)} providers` : undefined
      };
    }
  },
  {
    id: 'schools',
    label: 'Schools in England',
    source: 'Explore Education Statistics',
    sourceUrl:
      'https://explore-education-statistics.service.gov.uk/find-statistics/school-pupils-and-their-characteristics',
    api: 'REST · EES data-set query',
    apiUrl: `https://api.education.gov.uk/statistics/v1/data-sets/${EES_SCHOOLS_DATASET}/query`,
    snapshot: 24499,
    snapshotDetail: '6.52m pupils · 2025/26 census',
    asOf: '2026-06-04',
    resolve: async (f) => {
      const d = await getJson(
        f,
        `https://api.education.gov.uk/statistics/v1/data-sets/${EES_SCHOOLS_DATASET}/query`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(EES_SCHOOLS_QUERY)
        }
      );
      const row = d?.results?.[0]?.values ?? {};
      const schools = Number(row['0eJOT']);
      const pupils = Number(row['mU5X9']);
      return {
        value: schools,
        detail: Number.isFinite(pupils)
          ? `${(pupils / 1e6).toFixed(2)}m pupils · 2025/26 census`
          : undefined
      };
    }
  },
  {
    id: 'datasets',
    label: 'DfE datasets on data.gov.uk',
    source: 'data.gov.uk (CKAN)',
    sourceUrl: 'https://www.data.gov.uk/search?filters%5Bpublisher%5D=Department+for+Education',
    api: 'CKAN · package_search',
    apiUrl: 'https://ckan.publishing.service.gov.uk/api/3/action/package_search',
    snapshot: 231,
    asOf: '2026-06-06',
    resolve: async (f) => {
      const d = await getJson(
        f,
        'https://ckan.publishing.service.gov.uk/api/3/action/package_search?fq=organization:department-for-education&rows=0'
      );
      return { value: Number(d?.result?.count) };
    }
  },
  {
    id: 'govuk',
    label: 'DfE content on GOV.UK',
    source: 'GOV.UK Search API',
    sourceUrl: 'https://www.gov.uk/government/organisations/department-for-education',
    api: 'REST · search.json',
    apiUrl: 'https://www.gov.uk/api/search.json',
    snapshot: 11070,
    snapshotDetail: '3,270 research & statistics',
    asOf: '2026-06-06',
    resolve: async (f) => {
      const d = await getJson(
        f,
        'https://www.gov.uk/api/search.json?filter_organisations=department-for-education&count=0'
      );
      let stats: number | undefined;
      try {
        const s = await getJson(
          f,
          'https://www.gov.uk/api/search.json?filter_organisations=department-for-education&filter_content_purpose_supergroup=research_and_statistics&count=0'
        );
        stats = Number(s?.total);
      } catch {
        /* stats breakdown is optional */
      }
      return {
        value: Number(d?.total),
        detail: stats ? `${gb(stats)} research & statistics` : undefined
      };
    }
  }
];

// EES publications: powers both the "DfE statistical publications" stat and the live feed.
// pageSize is capped at 40 by the API (50 → HTTP 400); 40 returns all current publications.
const EES_PUBLICATIONS_URL =
  'https://api.education.gov.uk/statistics/v1/publications?page=1&pageSize=40';

export const EES_PUBLICATIONS_STAT = {
  id: 'ees-pubs',
  label: 'DfE statistical publications',
  source: 'Explore Education Statistics',
  sourceUrl: 'https://explore-education-statistics.service.gov.uk/find-statistics',
  api: 'REST · /v1/publications',
  apiUrl: 'https://api.education.gov.uk/statistics/v1/publications',
  snapshot: 22,
  asOf: '2026-06-06'
};

// A small, real fallback so the feed is never empty if the API is unreachable.
const EES_PUBLICATIONS_FALLBACK: Publication[] = [
  { title: 'Apprenticeships', slug: 'apprenticeships', lastPublished: '2026-03-26T09:30:13+00:00' },
  {
    title: 'Pupil absence in schools in England',
    slug: 'pupil-absence-in-schools-in-england',
    lastPublished: '2026-03-26T09:30:15+00:00'
  },
  {
    title: 'Early years foundation stage profile results',
    slug: 'early-years-foundation-stage-profile-results',
    lastPublished: '2025-11-27T09:30:14+00:00'
  },
  {
    title: 'Key stage 4 performance',
    slug: 'key-stage-4-performance',
    lastPublished: '2026-04-23T09:30:00+00:00'
  },
  {
    title: 'School workforce in England',
    slug: 'school-workforce-in-england',
    lastPublished: '2025-06-05T09:30:00+00:00'
  },
  {
    title: 'Schools, pupils and their characteristics',
    slug: 'school-pupils-and-their-characteristics',
    lastPublished: '2025-06-05T09:30:00+00:00'
  }
].map((p) => ({
  ...p,
  url: `https://explore-education-statistics.service.gov.uk/find-statistics/${p.slug}`
}));

export async function fetchPublications(
  f: Fetch
): Promise<{ count: number; publications: Publication[] }> {
  const d = await getJson(f, EES_PUBLICATIONS_URL);
  const publications: Publication[] = (d?.results ?? [])
    .map((p: any) => ({
      title: p.title,
      slug: p.slug,
      url: `https://explore-education-statistics.service.gov.uk/find-statistics/${p.slug}`,
      lastPublished: p.lastPublished ?? null,
      summary: typeof p.summary === 'string' ? p.summary : undefined
    }))
    .sort((a: Publication, b: Publication) =>
      (b.lastPublished ?? '').localeCompare(a.lastPublished ?? '')
    );
  return { count: Number(d?.paging?.totalResults), publications };
}

export function publicationsFallback(): { count: number; publications: Publication[] } {
  return { count: EES_PUBLICATIONS_STAT.snapshot, publications: EES_PUBLICATIONS_FALLBACK };
}

export function toResolvedStat(
  meta: { id: string; label: string; source: string; sourceUrl: string; api: string; apiUrl: string; asOf: string },
  value: number,
  detail: string | undefined,
  live: boolean
): ResolvedStat {
  return {
    id: meta.id,
    label: meta.label,
    value,
    detail,
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    api: meta.api,
    apiUrl: meta.apiUrl,
    live,
    asOf: meta.asOf
  };
}
