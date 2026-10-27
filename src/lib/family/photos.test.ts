import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PHOTO_MAX_BYTES, parsePhotoUpload, photoEntries, photoIds, photoKey, photoVersion } from './photos';

const OWNERS = ['owner@example.test', 'owner.alt@example.test'];
const isOwner = (e: string) => OWNERS.includes(e.trim().toLowerCase());
const idOf = (e: string) => `f_${e.split('@')[0]}`;

const jpeg = (size = 64) => {
  const b = Buffer.alloc(size, 7);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  return b;
};

describe('parsePhotoUpload', () => {
  it('decodes a base64 JPEG', () => {
    const bytes = jpeg();
    const r = parsePhotoUpload({ jpeg: bytes.toString('base64') });
    expect('bytes' in r && r.bytes.equals(bytes)).toBe(true);
  });

  it('forgives line breaks and a data-URL prefix', () => {
    const b64 = jpeg(300).toString('base64');
    const wrapped = `data:image/jpeg;base64,${b64.slice(0, 76)}\r\n${b64.slice(76)}`;
    expect(parsePhotoUpload({ jpeg: wrapped })).toHaveProperty('bytes');
  });

  it('refuses a body without a photo, with a sentence', () => {
    for (const body of [null, [], {}, { jpeg: 3 }, { jpeg: '   ' }]) {
      const r = parsePhotoUpload(body);
      expect(r).toHaveProperty('error');
      expect((r as { error: string }).error).toMatch(/\.$/);
    }
  });

  it('refuses text that is not base64', () => {
    expect(parsePhotoUpload({ jpeg: 'not base64 at all!' })).toEqual({ error: expect.stringMatching(/could not be read/) });
  });

  it('refuses anything that is not a JPEG', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(parsePhotoUpload({ jpeg: png.toString('base64') })).toEqual({ error: 'The photo must be a JPEG.' });
    expect(parsePhotoUpload({ jpeg: Buffer.from([0xff, 0xd8]).toString('base64') })).toEqual({ error: 'The photo must be a JPEG.' });
  });

  it('takes exactly 300 000 bytes and refuses one more', () => {
    expect(parsePhotoUpload({ jpeg: jpeg(PHOTO_MAX_BYTES).toString('base64') })).toHaveProperty('bytes');
    expect(parsePhotoUpload({ jpeg: jpeg(PHOTO_MAX_BYTES + 1).toString('base64') })).toEqual({
      error: 'That photo is too large. Keep it under 300 KB.',
    });
  });
});

describe('photoVersion', () => {
  it('is the first 12 hex of the SHA-256, and moves with the bytes', () => {
    const b = jpeg();
    expect(photoVersion(b)).toBe(createHash('sha256').update(b).digest('hex').slice(0, 12));
    expect(photoVersion(b)).toMatch(/^[0-9a-f]{12}$/);
    expect(photoVersion(jpeg(65))).not.toBe(photoVersion(b));
  });
});

describe('whose photo', () => {
  it('stores every owner address under the first, and a member under their own', () => {
    expect(photoKey('Owner.Alt@example.test', OWNERS, isOwner)).toBe('owner@example.test');
    expect(photoKey('owner@example.test', OWNERS, isOwner)).toBe('owner@example.test');
    expect(photoKey(' Kid@Example.test ', OWNERS, isOwner)).toBe('kid@example.test');
  });

  it('answers to every owner address’s id for the owner, one id for a member', () => {
    expect(photoIds('owner@example.test', OWNERS, isOwner, idOf)).toEqual(['f_owner', 'f_owner.alt']);
    expect(photoIds('kid@example.test', OWNERS, isOwner, idOf)).toEqual(['f_kid']);
  });

  it('lists ids, subjects and versions — never an email', () => {
    const subjects: Record<string, string> = { 'owner@example.test': 'john', 'kid@example.test': 'kid' };
    const list = photoEntries(
      [
        { email: 'owner@example.test', version: 'aaaaaaaaaaaa' },
        { email: 'kid@example.test', version: 'bbbbbbbbbbbb' },
        { email: 'parent@example.test', version: 'cccccccccccc' },
      ],
      OWNERS,
      isOwner,
      idOf,
      (e) => subjects[e] ?? null,
    );
    expect(list).toEqual([
      { id: 'f_owner', subject: 'john', version: 'aaaaaaaaaaaa' },
      { id: 'f_owner.alt', subject: 'john', version: 'aaaaaaaaaaaa' },
      { id: 'f_kid', subject: 'kid', version: 'bbbbbbbbbbbb' },
      { id: 'f_parent', subject: null, version: 'cccccccccccc' },
    ]);
    expect(JSON.stringify(list)).not.toContain('@');
  });
});
