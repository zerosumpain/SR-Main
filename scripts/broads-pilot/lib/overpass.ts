// Minimal Overpass API client for the Broads Pilot build pipeline.
// NOTE: a descriptive User-Agent is required — the default fetch/curl UA gets a
// 406 from the public Overpass instances.

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
  members?: { type: string; ref: number; role: string }[];
}
export interface OsmJson {
  elements: OsmElement[];
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run an Overpass QL query, rotating endpoints with backoff on failure. */
export async function overpass(query: string): Promise<OsmJson> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'BroadsPilot/1.0 (Norfolk Broads route planner; +https://strangeramblings.com/projects/broads-pilot)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status} from ${url}`);
      const json = (await res.json()) as OsmJson;
      if (!json.elements) throw new Error(`Overpass returned no elements from ${url}`);
      return json;
    } catch (e) {
      lastErr = e;
      console.warn(`  overpass attempt ${attempt + 1} (${url}) failed: ${e}`);
      await sleep(4000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export const BROADS_BBOX = '52.30,1.28,52.85,1.80'; // S,W,N,E
