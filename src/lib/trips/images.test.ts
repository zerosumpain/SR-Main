import { describe, expect, it } from 'vitest';
import { commonsInfoUrl, imageFileFromEntity, imageFromCommons, plainText, wikidataId } from './images';

// v7: places' photographs from Wikimedia Commons (pure half).
describe('wikidata ids', () => {
  it('accepts Q-ids only', () => {
    expect(wikidataId('Q99309')).toBe('Q99309');
    expect(wikidataId(' Q1 ')).toBe('Q1');
    expect(wikidataId('P18')).toBeNull();
    expect(wikidataId('Q1; Q2')).toBeNull();
    expect(wikidataId(42)).toBeNull();
  });
});

describe('the image claim', () => {
  const entity = (claims: unknown[]) => ({ entities: { Q99309: { claims: { P18: claims } } } });
  const claim = (value: unknown, rank = 'normal') => ({ rank, mainsnak: { datavalue: { value } } });

  it('takes a preferred image first, never a deprecated one', () => {
    expect(imageFileFromEntity(entity([claim('A.jpg'), claim('B.jpg', 'preferred')]), 'Q99309')).toBe('B.jpg');
    expect(imageFileFromEntity(entity([claim('Old.jpg', 'deprecated'), claim('New.JPG')]), 'Q99309')).toBe('New.JPG');
  });
  it('ignores what is not a photograph, and entries with none', () => {
    expect(imageFileFromEntity(entity([claim('Plan.svg')]), 'Q99309')).toBeNull();
    expect(imageFileFromEntity({ entities: { Q99309: {} } }, 'Q99309')).toBeNull();
    expect(imageFileFromEntity(null, 'Q99309')).toBeNull();
  });
  it('asks Commons for a thumbnail and the credits', () => {
    const url = new URL(commonsInfoUrl('Pantheon Rome.jpg'));
    expect(url.searchParams.get('titles')).toBe('File:Pantheon Rome.jpg');
    expect(url.searchParams.get('iiurlwidth')).toBe('800');
    expect(url.searchParams.get('iiprop')).toContain('extmetadata');
  });
});

describe('the Commons answer', () => {
  const page = (info: Record<string, unknown>) => ({ query: { pages: { '-1': { imageinfo: [info] } } } });
  const info = {
    thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Pantheon.jpg/800px-Pantheon.jpg',
    thumbwidth: 800, thumbheight: 533,
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Pantheon.jpg',
    extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane&nbsp;Smith</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
  };

  it('keeps the thumbnail, its size, the credit and licence, and the file page', () => {
    expect(imageFromCommons(page(info), 'Q99309')).toEqual({
      url: info.thumburl, width: 800, height: 533, credit: 'Jane Smith', license: 'CC BY-SA 4.0', sourceUrl: info.descriptionurl, wikidata: 'Q99309',
    });
  });
  it('refuses an image not on Wikimedia’s upload host', () => {
    expect(imageFromCommons(page({ ...info, thumburl: 'https://evil.example/x.jpg', url: 'https://evil.example/x.jpg' }), 'Q1')).toBeNull();
    expect(imageFromCommons({ query: { pages: {} } }, 'Q1')).toBeNull();
  });
  it('strips HTML from credits', () => {
    expect(plainText('<span>A &amp; B</span>')).toBe('A & B');
    expect(plainText('')).toBeNull();
    expect(plainText('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
