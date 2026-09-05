import { describe, expect, it } from 'vitest';
import {
  PREVIEW_TICKET_PREFIX,
  PREVIEW_TICKET_TTL_SECONDS,
  issuePreviewTicket,
  splitPreviewTicket,
  verifyPreviewTicket,
} from './preview-ticket';

describe('preview tickets', () => {
  const now = 1_788_472_800_000;
  const BUILD = '8602b13a-c31d-406c-b259-d1259d3c18be';

  it('accepts a freshly issued ticket for its own build', () => {
    const ticket = issuePreviewTicket(BUILD, 'auth-secret', now);
    expect(verifyPreviewTicket(ticket, BUILD, 'auth-secret', now)).toBe(true);
  });

  it('rejects tampering, the wrong key, and expiry', () => {
    const ticket = issuePreviewTicket(BUILD, 'auth-secret', now);
    expect(verifyPreviewTicket(ticket + '0', BUILD, 'auth-secret', now)).toBe(false);
    expect(verifyPreviewTicket(ticket, BUILD, 'wrong-secret', now)).toBe(false);
    expect(
      verifyPreviewTicket(ticket, BUILD, 'auth-secret', now + (PREVIEW_TICKET_TTL_SECONDS + 1) * 1000),
    ).toBe(false);
  });

  it('does NOT let one build’s ticket read another build', () => {
    // The whole point of binding buildId into the signed material. A preview is
    // handed to untrusted generated code, so a ticket that worked across builds
    // would let any one app read every other app's files.
    const ticket = issuePreviewTicket(BUILD, 'auth-secret', now);
    expect(verifyPreviewTicket(ticket, 'some-other-build-id', 'auth-secret', now)).toBe(false);
  });

  it('refuses to mint without a secret or a build id', () => {
    expect(() => issuePreviewTicket(BUILD, '')).toThrow();
    expect(() => issuePreviewTicket('', 'auth-secret')).toThrow();
  });

  it('verifies nothing when inputs are missing', () => {
    const ticket = issuePreviewTicket(BUILD, 'auth-secret', now);
    expect(verifyPreviewTicket(undefined, BUILD, 'auth-secret', now)).toBe(false);
    expect(verifyPreviewTicket(ticket, undefined, 'auth-secret', now)).toBe(false);
    expect(verifyPreviewTicket(ticket, BUILD, undefined, now)).toBe(false);
    expect(verifyPreviewTicket('garbage', BUILD, 'auth-secret', now)).toBe(false);
  });
});

describe('splitPreviewTicket', () => {
  it('pulls the ticket off the front and leaves the asset path', () => {
    const t = 'abc123';
    expect(splitPreviewTicket(`${PREVIEW_TICKET_PREFIX}${t}/explainer-kit/shell.js`)).toEqual({
      ticket: t,
      path: 'explainer-kit/shell.js',
    });
  });

  it('handles a ticket with no path after it — the index request', () => {
    expect(splitPreviewTicket(`${PREVIEW_TICKET_PREFIX}abc`)).toEqual({ ticket: 'abc', path: '' });
    expect(splitPreviewTicket(`${PREVIEW_TICKET_PREFIX}abc/`)).toEqual({ ticket: 'abc', path: '' });
  });

  it('leaves an ordinary path alone', () => {
    expect(splitPreviewTicket('explainer-kit/shell.js')).toEqual({
      ticket: null,
      path: 'explainer-kit/shell.js',
    });
    expect(splitPreviewTicket('')).toEqual({ ticket: null, path: '' });
  });

  it('does not treat a deeper _t_ segment as a ticket', () => {
    // Only the FIRST segment is authorisation. A file called `_t_x` further
    // down is a filename.
    expect(splitPreviewTicket('chapter-1/_t_x/thing.css')).toEqual({
      ticket: null,
      path: 'chapter-1/_t_x/thing.css',
    });
  });

  it('round-trips a real ticket through the path form', () => {
    const ticket = issuePreviewTicket('b1', 'auth-secret');
    const split = splitPreviewTicket(`${PREVIEW_TICKET_PREFIX}${ticket}/a/b.css`);
    expect(split.path).toBe('a/b.css');
    expect(verifyPreviewTicket(split.ticket ?? undefined, 'b1', 'auth-secret')).toBe(true);
  });
});
