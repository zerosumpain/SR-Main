import { and, eq, isNull, or, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';
import { getCredential, listCredentials } from '$lib/integrations/credentials';
import { parseMapbox, parseNominatim, type PlaceLookup } from './geocode';

export async function geocoderStatus(): Promise<string> {
  if (process.env.PRESENCE_GEOCODER_URL) return 'Automatic place lookup enabled · OpenStreetMap';
  if ((await listCredentials('mapbox')).length) return 'Automatic address lookup enabled · Mapbox';
  return 'Automatic lookup is waiting for a Mapbox credential in Connections, or a private geocoder.';
}
async function lookup(lat: number, lon: number, fetchImpl: typeof fetch): Promise<PlaceLookup | null> {
  const configured = process.env.PRESENCE_GEOCODER_URL;
  let url: URL, provider: 'mapbox' | 'nominatim';
  if (configured) {
    url = new URL(configured);
    // Household locations must never go to the community-operated public endpoint.
    if (url.hostname === 'nominatim.openstreetmap.org') throw new Error('Use a privately operated geocoder for household locations.');
    provider = 'nominatim';
    for (const [k, v] of Object.entries({ lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: '18', addressdetails: '1', namedetails: '1', 'accept-language': 'en' })) url.searchParams.set(k, v);
  } else {
    const credentials = await listCredentials('mapbox');
    credentials.sort((a, b) => +b.createdAt - +a.createdAt);
    if (!credentials.length) throw new Error('Place lookup needs a Mapbox credential.');
    const credential = await getCredential<'apikey'>(credentials[0].id);
    if (credential?.kind !== 'apikey' || !credential.payload.key) throw new Error('Place lookup credential is unavailable.');
    provider = 'mapbox';
    url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
    for (const [k, v] of Object.entries({ latitude: String(lat), longitude: String(lon), access_token: credential.payload.key,
      permanent: 'true', language: 'en', types: 'address,street,place,locality,neighborhood' })) url.searchParams.set(k, v);
  }
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'StrangeRamblings/1.0 (https://strangeramblings.com)' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Place lookup provider returned ${response.status}.`);
  const value = await response.json();
  return provider === 'mapbox' ? parseMapbox(value, lat, lon) : parseNominatim(value, lat, lon);
}
/** Persist attempts on the place; confirmed names and geometry changes win races. */
export async function geocodePlace(id: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  return db.transaction(async tx => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(7280928) as acquired`);
    if (!(lock.rows[0] as { acquired?: boolean })?.acquired) return false;
    const [p] = await tx.select().from(daydreamPlaces).where(eq(daydreamPlaces.id, id));
    if (!p || p.label || p.status !== 'active' || p.suggestedLabel || (p.suggestedAt && Date.now() - +p.suggestedAt < 60 * 60_000)) return false;
    // A failed request still gets a cooldown, but never a fake result.
    await tx.update(daydreamPlaces).set({ suggestedAt: new Date() }).where(eq(daydreamPlaces.id, id));
    let result: PlaceLookup | null;
    try { result = await lookup(p.lat, p.lon, fetchImpl); }
    catch { return false; } // URLs can contain credentials; never log provider errors verbatim.
    if (!result) return false;
    const rows = await tx.update(daydreamPlaces).set({ suggestedLabel: result.label, suggestedAddress: result.address,
      suggestedKind: result.kind, suggestedProvider: result.provider, suggestedPrecision: result.precision, suggestedAt: new Date(), source: 'geocoded', updatedAt: new Date() })
      .where(and(eq(daydreamPlaces.id, id), isNull(daydreamPlaces.label), eq(daydreamPlaces.status, 'active'), eq(daydreamPlaces.lat, p.lat), eq(daydreamPlaces.lon, p.lon)))
      .returning({ id: daydreamPlaces.id });
    return rows.length > 0;
  });
}
export async function geocodePendingPlaces(): Promise<number> {
  const rows = await db.select({ id: daydreamPlaces.id }).from(daydreamPlaces).where(and(eq(daydreamPlaces.status, 'active'),
    isNull(daydreamPlaces.label), isNull(daydreamPlaces.suggestedLabel), or(isNull(daydreamPlaces.suggestedAt), lt(daydreamPlaces.suggestedAt, new Date(Date.now() - 60 * 60_000)))))
    .orderBy(sql`${daydreamPlaces.lastSeenAt} desc nulls last`).limit(1);
  let count = 0;
  for (const row of rows) if (await geocodePlace(row.id)) count++;
  return count;
}
