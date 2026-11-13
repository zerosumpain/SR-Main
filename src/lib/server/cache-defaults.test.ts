import { describe, expect, it } from 'vitest';
import { defaultsToNoStore } from './cache-defaults';

const h = (init: Record<string, string> = {}) => new Headers(init);

describe('defaultsToNoStore', () => {
  it('applies to silent owner pages and APIs, including the gate 401', () => {
    expect(defaultsToNoStore('/api/jkai/builds', h({ 'Content-Type': 'application/json' }))).toBe(true);
    expect(defaultsToNoStore('/admin', h())).toBe(true);
    expect(defaultsToNoStore('/admin/access', h({ 'Content-Type': 'text/html' }))).toBe(true);
    expect(defaultsToNoStore('/jkai/develop/__data.json', h())).toBe(true);
  });

  it('leaves a handler that chose its own caching alone', () => {
    expect(defaultsToNoStore('/api/landing/vitals', h({ 'Cache-Control': 'public, max-age=60' }))).toBe(false);
  });

  it('never touches an event stream', () => {
    expect(defaultsToNoStore('/api/workflows/orchestrator/chat/stream', h({ 'Content-Type': 'text/event-stream' }))).toBe(false);
  });

  it('leaves public pages and look-alike paths alone', () => {
    expect(defaultsToNoStore('/', h())).toBe(false);
    expect(defaultsToNoStore('/blog/post', h())).toBe(false);
    expect(defaultsToNoStore('/administrivia', h())).toBe(false);
    expect(defaultsToNoStore('/jkaiish', h())).toBe(false);
  });
});
