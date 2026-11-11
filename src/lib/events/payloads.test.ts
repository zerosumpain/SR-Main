import { beforeEach, describe, expect, it } from 'vitest';
import { EVENT_CATALOGUE } from './catalogue';
import {
  captureReadyPayload,
  daydreamActedPayload,
  familyAlertPayload,
  firstInWindow,
  gameFinishedPayload,
  pullOpenedPayload,
  releaseLivePayload,
  resetSaid,
  safePlaceName,
  shareOpenedPayload,
  tripNeedsYouPayload,
  wishlistOfferPayload,
} from './payloads';

/** Keys no feature event may carry, and what a value must never look like. */
const BANNED_KEY = /^(lat|lon|lng|latitude|longitude|coords?|position|accuracy|address|postcode|email|phone|ip|userAgent|agent|country|visitorHash|networkHash|transcript|message|body)$/i;
const COORDINATE = /-?\d{1,3}\.\d{4,}/;

function expectClean(payload: Record<string, unknown>) {
  for (const [key, value] of Object.entries(payload)) {
    expect(key).not.toMatch(BANNED_KEY);
    expect(typeof value === 'object').toBe(false);
    expect(String(value)).not.toMatch(COORDINATE);
    expect(String(value)).not.toContain('@');
  }
}

const exampleKeys = (type: string) => Object.keys(EVENT_CATALOGUE.find((e) => e.type === type)!.payloadExample).sort();

beforeEach(() => resetSaid());

describe('safePlaceName', () => {
  it('keeps a name somebody gave a place', () => {
    for (const name of ['School', "Gran's", 'home', 'Swimming pool', 'Park Road Surgery']) expect(safePlaceName(name)).toBe(name);
  });

  it('drops a position, a street address, a postcode and a contact detail', () => {
    for (const not of [
      '51.50000, -0.12000',
      'near 51.500012',
      '12 Example Road',
      'Flat 3 Example House',
      'Example Road',
      'Example Parade, Exampletown',
      'Exampletown AB1 2CD',
      'someone@example.test',
      '+44 0000 000000',
      '',
      null,
    ]) {
      expect(safePlaceName(not), String(not)).toBeNull();
    }
  });
});

describe('family.alert', () => {
  it('carries kind, person, place and title, and nothing else', () => {
    const facts = { kind: 'arrive', person: 'Sam', place: 'School', title: 'Sam arrived at School', lat: 51.5, lon: -0.12, email: 'sam@example.test' };
    const payload = familyAlertPayload(facts);
    expect(payload).toEqual({ kind: 'arrive', person: 'Sam', place: 'School', title: 'Sam arrived at School' });
    expect(Object.keys(payload).sort()).toEqual(exampleKeys('family.alert'));
    expectClean(payload);
  });

  it('takes a place that is not a name out of the place and the title alike', () => {
    const payload = familyAlertPayload({ kind: 'stopped', person: 'Sam', place: '12 Example Road', title: 'Sam stopped at 12 Example Road' });
    expect(payload).toEqual({ kind: 'stopped', person: 'Sam', title: 'Sam stopped at a place' });
    const coords = familyAlertPayload({ kind: 'journey', person: 'Sam', place: '51.50000, -0.12000', title: 'Sam arrived safely at 51.50000, -0.12000' });
    expect(coords).toEqual({ kind: 'journey', person: 'Sam', title: 'Sam arrived safely at a place' });
    expectClean(coords);
  });

  it('leaves the place out when there is none', () => {
    expect(familyAlertPayload({ kind: 'battery', person: 'Sam', title: "Sam's phone is on 14%" })).toEqual({ kind: 'battery', person: 'Sam', title: "Sam's phone is on 14%" });
  });
});

describe('the other feature events', () => {
  it('wishlist.offer: a price in pounds, and only an http link', () => {
    const payload = wishlistOfferPayload({ wishId: 'w1', title: 'Example kettle', pricePence: 2499, url: 'https://shop.example.com/kettle' });
    expect(payload).toEqual({ wishId: 'w1', title: 'Example kettle', price: 24.99, currency: 'GBP', url: 'https://shop.example.com/kettle' });
    expect(Object.keys(payload).sort()).toEqual(exampleKeys('wishlist.offer'));
    expect(wishlistOfferPayload({ wishId: 'w1', title: 'Example kettle', pricePence: null, url: 'javascript:alert(1)' })).toEqual({ wishId: 'w1', title: 'Example kettle' });
  });

  it('trip.needs_you, capture.ready, release.live, pull.opened, game.finished and daydream.acted match their examples', () => {
    const built: Record<string, Record<string, unknown>> = {
      'trip.needs_you': tripNeedsYouPayload({ tripId: 't1', title: 'Summer week away', reason: 'question' }),
      'capture.ready': captureReadyPayload({ captureId: 'c1', title: 'Planning call', followUps: 2 }),
      'release.live': releaseLivePayload({ app: 'example-app', sha: '0123abc' }),
      'pull.opened': pullOpenedPayload({ repo: 'example-org/example-repo', number: 7, title: 'Add the example feature' }),
      'game.finished': gameFinishedPayload({ game: 'example-game', roomId: 'ABCD', winner: 'Sam' }),
      'daydream.acted': daydreamActedPayload({ daydreamId: 'd1', title: 'Tidy the example backlog', action: 'reminder' }),
      'share.opened': shareOpenedPayload({ shareId: 's1', project: 'example-project', label: 'For the review group' }),
    };
    for (const [type, payload] of Object.entries(built)) {
      expect(Object.keys(payload).sort(), type).toEqual(exampleKeys(type));
      expectClean(payload);
    }
  });

  it('drops what is optional and absent, and counts follow-ups rather than quoting them', () => {
    expect(shareOpenedPayload({ shareId: 's1', project: null, label: '' })).toEqual({ shareId: 's1' });
    expect(releaseLivePayload({ app: 'example-app' })).toEqual({ app: 'example-app' });
    expect(gameFinishedPayload({ game: 'example-game', roomId: 'ABCD', winner: '' })).toEqual({ game: 'example-game', roomId: 'ABCD' });
    expect(captureReadyPayload({ captureId: 'c1', title: '', followUps: undefined })).toEqual({ captureId: 'c1', title: 'Capture', followUps: 0 });
  });
});

describe('firstInWindow', () => {
  it('says a key once inside the window and again after it', () => {
    expect(firstInWindow('k', 600_000, 1_000)).toBe(true);
    expect(firstInWindow('k', 600_000, 500_000)).toBe(false);
    expect(firstInWindow('other', 600_000, 500_000)).toBe(true);
    expect(firstInWindow('k', 600_000, 601_001)).toBe(true);
  });
});
