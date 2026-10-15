import { describe, expect, it } from 'vitest';
import {
  CAST_MAX_SECONDS,
  CAST_TICKET_TTL_SECONDS,
  castMediaPath,
  castRoute,
  failureReason,
  issueCastTicket,
  ticketFromSegment,
  verifyCastTicket,
  ytDlpArgs,
} from './backlog-cast';

const ID = '0b6f3c1e-8f4a-4c2b-9d7e-1a2b3c4d5e6f';
const OTHER = '11111111-2222-4333-8444-555555555555';
const SECRET = 'x'.repeat(48);
const NOW = Date.UTC(2026, 9, 15, 19, 0, 0);

describe('castRoute', () => {
  it('fetches YouTube, TikTok and Instagram videos', () => {
    for (const provider of ['youtube', 'tiktok', 'instagram']) {
      expect(castRoute({ kind: 'video', url: 'https://example.test/v', provider })).toEqual({ fetch: true });
    }
  });

  it('sends a web page to the phone to mirror', () => {
    const r = castRoute({ kind: 'page', url: 'https://example.test/article', provider: 'web' });
    expect(r.fetch).toBe(false);
    if (!r.fetch) expect(r.fallback).toMatchObject({ state: 'fallback', fallback: 'mirror', url: 'https://example.test/article' });
  });

  it('never fetches an Instagram post that is not a reel', () => {
    expect(castRoute({ kind: 'page', url: 'https://instagram.com/p/abc', provider: 'instagram' }).fetch).toBe(false);
  });

  it('has nothing to play for an idea', () => {
    const r = castRoute({ kind: 'idea', url: null, provider: null });
    expect(r.fetch).toBe(false);
    if (!r.fetch) expect(r.fallback).toMatchObject({ fallback: 'mirror', url: null });
  });
});

describe('failureReason', () => {
  it('names a login wall', () => {
    expect(failureReason('ERROR: [Instagram] x: use --cookies for the authentication')).toMatch(/login/);
  });
  it('names a removed video', () => {
    expect(failureReason('ERROR: Video unavailable')).toMatch(/gone/);
  });
  it('falls back to a plain sentence', () => {
    expect(failureReason('')).toBe('The video could not be fetched for the TV.');
  });
});

describe('ytDlpArgs', () => {
  const args = ytDlpArgs('https://www.tiktok.com/@a/video/1', '/c/video.%(ext)s');

  it('runs only the three extractors, never the generic one', () => {
    expect(args[args.indexOf('--use-extractors') + 1]).toBe('youtube,tiktok,instagram');
  });

  it('ends options before the URL, so a link cannot become a flag', () => {
    expect(args.slice(-2)).toEqual(['--', 'https://www.tiktok.com/@a/video/1']);
  });

  it('refuses live and over-long videos', () => {
    expect(args[args.indexOf('--match-filter') + 1]).toBe(`!is_live & duration<=?${CAST_MAX_SECONDS}`);
  });
});

describe('cast tickets', () => {
  it('opens the item it was issued for', () => {
    const { ticket, expiresAt } = issueCastTicket(ID, SECRET, NOW);
    expect(verifyCastTicket(ticket, SECRET, NOW)).toBe(ID);
    expect(expiresAt.getTime()).toBe(NOW + CAST_TICKET_TTL_SECONDS * 1000);
  });

  it('stops working when it expires', () => {
    const { ticket } = issueCastTicket(ID, SECRET, NOW);
    expect(verifyCastTicket(ticket, SECRET, NOW + CAST_TICKET_TTL_SECONDS * 1000 + 1000)).toBeNull();
  });

  it('cannot be moved to another item', () => {
    const { ticket } = issueCastTicket(ID, SECRET, NOW);
    expect(verifyCastTicket(ticket.replace(ID, OTHER), SECRET, NOW)).toBeNull();
  });

  it('cannot be stretched past its lifetime', () => {
    const { ticket } = issueCastTicket(ID, SECRET, NOW);
    const parts = ticket.split('.');
    parts[1] = String(Number(parts[1]) + 3600);
    expect(verifyCastTicket(parts.join('.'), SECRET, NOW)).toBeNull();
  });

  it('is refused under another secret, and without one', () => {
    const { ticket } = issueCastTicket(ID, SECRET, NOW);
    expect(verifyCastTicket(ticket, 'y'.repeat(48), NOW)).toBeNull();
    expect(verifyCastTicket(ticket, undefined, NOW)).toBeNull();
    expect(() => issueCastTicket(ID, '', NOW)).toThrow();
  });

  it('refuses rubbish', () => {
    expect(verifyCastTicket('../../etc/passwd', SECRET, NOW)).toBeNull();
    expect(verifyCastTicket('', SECRET, NOW)).toBeNull();
  });

  it('round-trips through the TV path', () => {
    const { ticket } = issueCastTicket(ID, SECRET, NOW);
    const segment = castMediaPath(ticket).split('/').pop()!;
    expect(segment.endsWith('.mp4')).toBe(true);
    expect(verifyCastTicket(ticketFromSegment(segment), SECRET, NOW)).toBe(ID);
  });
});
