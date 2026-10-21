import { describe, expect, it } from 'vitest';
import { CENTRE_STAY_ID, isCentreStay, withCentreStay } from './centre-stay';

const TRIP = { startDate: '2026-10-26', endDate: '2026-10-30' };
const CENTRE = { lat: 41.8986, lng: 12.4769 };

describe('the stand-in centre stay', () => {
  it('stands in only when there is no stay and the pack found a centre', () => {
    const [s] = withCentreStay(TRIP, [], CENTRE);
    expect(s).toMatchObject({ id: CENTRE_STAY_ID, location: CENTRE, fromDate: '2026-10-26', toDate: '2026-10-30' });
    expect(isCentreStay(s)).toBe(true);
    expect(withCentreStay(TRIP, [], null)).toEqual([]);
    const real = { id: 's1', name: 'Flat', address: null, location: CENTRE, fromDate: '2026-10-26', toDate: '2026-10-30', checkInMin: null, checkOutMin: null };
    expect(withCentreStay(TRIP, [real], CENTRE)).toEqual([real]);
  });
});
