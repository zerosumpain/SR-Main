import { describe, it, expect } from 'vitest';
import { kindFromMime, extensionForMime, isAllowedMime } from '$lib/jkai/media/mime';

describe('kindFromMime', () => {
  it('maps images', () => {
    expect(kindFromMime('image/jpeg')).toBe('image');
    expect(kindFromMime('image/png')).toBe('image');
    expect(kindFromMime('image/webp')).toBe('image');
  });
  it('maps audio', () => {
    expect(kindFromMime('audio/mpeg')).toBe('audio');
    expect(kindFromMime('audio/ogg')).toBe('audio');
    expect(kindFromMime('audio/webm')).toBe('audio');
  });
  it('maps video', () => {
    expect(kindFromMime('video/mp4')).toBe('video');
    expect(kindFromMime('video/webm')).toBe('video');
  });
  it('maps pdf distinctly from document', () => {
    expect(kindFromMime('application/pdf')).toBe('pdf');
  });
  it('maps text', () => {
    expect(kindFromMime('text/plain')).toBe('text');
    expect(kindFromMime('text/markdown')).toBe('text');
    expect(kindFromMime('application/json')).toBe('text');
    expect(kindFromMime('text/csv')).toBe('text');
  });
  it('maps office docs to document', () => {
    expect(kindFromMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document');
  });
  it('returns null for unknown', () => {
    expect(kindFromMime('application/x-bogus')).toBeNull();
  });
});

describe('extensionForMime', () => {
  it('returns canonical extensions', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('audio/mpeg')).toBe('mp3');
    expect(extensionForMime('audio/ogg')).toBe('ogg');
    expect(extensionForMime('video/mp4')).toBe('mp4');
    expect(extensionForMime('application/pdf')).toBe('pdf');
    expect(extensionForMime('text/plain')).toBe('txt');
    expect(extensionForMime('text/markdown')).toBe('md');
    expect(extensionForMime('text/csv')).toBe('csv');
    expect(extensionForMime('application/json')).toBe('json');
  });
  it('returns bin for unknown', () => {
    expect(extensionForMime('application/x-bogus')).toBe('bin');
  });
});

describe('isAllowedMime', () => {
  it('allows standard media + text', () => {
    expect(isAllowedMime('image/jpeg')).toBe(true);
    expect(isAllowedMime('audio/mpeg')).toBe(true);
    expect(isAllowedMime('video/mp4')).toBe(true);
    expect(isAllowedMime('application/pdf')).toBe(true);
    expect(isAllowedMime('text/plain')).toBe(true);
  });
  it('rejects executables and unknown', () => {
    expect(isAllowedMime('application/x-msdownload')).toBe(false);
    expect(isAllowedMime('application/x-bogus')).toBe(false);
  });
});
