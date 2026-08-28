import { describe, it, expect } from 'vitest';
import { kindFromOsm, pickName } from './geocode';

describe('pickName', () => {
  it('prefers the feature name — that is what a person calls it', () => {
    const { name } = pickName({
      name: 'Costa Coffee',
      display_name: 'Costa Coffee, 12 High Row, Darlington, County Durham, England',
      address: { shop: 'Coffee', road: 'High Row' },
    });
    expect(name).toBe('Costa Coffee');
  });

  it('falls back through the address tags in order of usefulness', () => {
    expect(pickName({ address: { shop: 'Sports Direct', road: 'High Row' } }).name).toBe(
      'Sports Direct',
    );
    expect(pickName({ address: { amenity: 'Library', road: 'High Row' } }).name).toBe('Library');
  });

  it('offers a street address when nothing is named — it says WHERE, which is the point', () => {
    expect(pickName({ address: { house_number: '12', road: 'High Row' } }).name).toBe('12 High Row');
    expect(pickName({ address: { road: 'High Row' } }).name).toBe('High Row');
  });

  it('returns null rather than suggesting a county', () => {
    // Anything vaguer than a road is not a suggestion, it is noise. The biome's
    // town-level geocode exists for a different job.
    expect(pickName({ address: { county: 'County Durham', country: 'England' } }).name).toBeNull();
  });

  it('trims the display name to something readable', () => {
    const { address } = pickName({
      display_name: 'Costa, 12 High Row, Darlington, County Durham, England, DL1, United Kingdom',
      address: {},
    });
    expect(address).toBe('Costa, 12 High Row, Darlington');
  });

  it('survives an empty reply', () => {
    expect(pickName({})).toEqual({ name: null, address: null });
  });
});

describe('kindFromOsm', () => {
  it('maps tags it is confident about', () => {
    expect(kindFromOsm('amenity', 'cafe')).toBe('cafe');
    expect(kindFromOsm('amenity', 'school')).toBe('school');
    expect(kindFromOsm('leisure', 'fitness_centre')).toBe('gym');
    expect(kindFromOsm('shop', 'sports')).toBe('shop');
    expect(kindFromOsm('building', 'house')).toBe('home');
  });

  it('returns null rather than guessing', () => {
    // A wrong pre-selected kind is worse than an unset one: the owner corrects
    // an empty field and accepts a filled one without reading it.
    expect(kindFromOsm('highway', 'bus_stop')).toBeNull();
    expect(kindFromOsm(null, null)).toBeNull();
  });
});
