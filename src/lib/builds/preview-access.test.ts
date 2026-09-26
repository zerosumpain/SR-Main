import { expect, it } from 'vitest';
import { previewAccess } from './preview-access';

const link = (expires: number) => `https://preview.example/?__sr_grant=${btoa(JSON.stringify({ expires }))}.signature`;
it('distinguishes an expired saved link from a usable grant, including its expiry boundary', () => {
  expect(previewAccess(link(1000), 999)).toMatchObject({ expiresAt: 1000, expired: false });
  expect(previewAccess(link(1000), 1000).expired).toBe(true);
  expect(previewAccess(link(1000), 2000).expired).toBe(true);
});
it('handles older links and malformed grants without claiming expiry', () => {
  for (const url of [null, 'bad url', 'https://preview.example', 'https://preview.example/?__sr_grant=bad']) {
    expect(previewAccess(url).expiresAt).toBeNull();
  }
  expect(previewAccess('http://127.0.0.1:5281').loopback).toBe(true);
  expect(previewAccess('https://preview.example').loopback).toBe(false);
});
