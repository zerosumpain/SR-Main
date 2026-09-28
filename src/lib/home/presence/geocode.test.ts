import { describe, expect, it } from 'vitest';
import { parseMapbox, parseNominatim } from './geocode';
describe('permanent reverse geocoding result quality', () => {
  const feature = (type = 'address', lon = -.12) => ({ geometry: { coordinates: [lon, 51.5] }, properties: { feature_type: type, name: '12 Example Road', full_address: '12 Example Road, Sampletown' } });
  it('keeps a nearby address and its provenance without inventing a venue', () => {
    expect(parseMapbox({ features: [feature()] }, 51.5, -.12)).toMatchObject({ label: '12 Example Road', provider: 'Mapbox', precision: 'address', kind: 'other' });
  });
  it('rejects distant buildings, malformed data and unsupported country-only results', () => {
    expect(parseMapbox({ features: [feature('address', -1)] }, 51.5, -.12)).toBeNull();
    expect(parseMapbox({ features: [feature('country')] }, 51.5, -.12)).toBeNull();
    expect(parseMapbox(null, 51.5, -.12)).toBeNull();
    expect(parseNominatim({}, 51.5, -.12)).toBeNull();
  });
  it('accepts a nearby venue from a private Nominatim server, but does not infer a remote venue', () => {
    const result = { lat: '51.5', lon: '-0.12', name: 'Sample College', type: 'college', address: { road: 'Example Road' }, display_name: 'Sample College, Example Road' };
    expect(parseNominatim(result, 51.5, -.12)).toMatchObject({ label: 'Sample College', kind: 'school', precision: 'venue' });
    expect(parseNominatim({ ...result, lat: '51.503' }, 51.5, -.12)).toMatchObject({ label: 'Example Road', kind: 'other', precision: 'street' });
  });
});
