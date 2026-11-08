import { describe, expect, it, vi } from 'vitest';
import { postAsJob } from './job-client';

// v6: the site page posts with async: true and polls the job.
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wait = async () => {};

describe('postAsJob', () => {
  it('posts with async: true, then polls until done and returns the result', async () => {
    const polls = [reply(200, { job: { id: 'j1', status: 'running', result: null, error: null } }), reply(200, { job: { id: 'j1', status: 'done', result: { ideas: [1] }, error: null } })];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ date: 'd', async: true });
        return reply(202, { job: { id: 'j1', status: 'running', result: null, error: null } });
      }
      expect(url).toBe('/api/trips/jobs/j1');
      return polls.shift()!;
    });
    expect(await postAsJob('/api/trips/t/ideas', { date: 'd' }, { fetch: f as never, wait })).toEqual({ ok: true, body: { ideas: [1] } });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('takes a synchronous answer as it is (an older server, or a 400)', async () => {
    const f = async () => reply(400, { error: 'stage is morning…' });
    expect(await postAsJob('/x', {}, { fetch: f as never, wait })).toEqual({ ok: false, body: { error: 'stage is morning…' } });
  });

  it('a failed job, a lost job and a job that never ends each say so plainly', async () => {
    const start = reply(202, { job: { id: 'j', status: 'running' } });
    const failed = vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'POST' ? start.clone() : reply(200, { job: { id: 'j', status: 'failed', result: null, error: 'That took too long — try again.' } })));
    expect((await postAsJob('/x', {}, { fetch: failed as never, wait })).body.error).toBe('That took too long — try again.');
    const lost = async (_u: string, init?: RequestInit) => (init?.method === 'POST' ? start.clone() : reply(404, { error: 'gone' }));
    expect((await postAsJob('/x', {}, { fetch: lost as never, wait })).body.error).toMatch(/lost in an update/);
    const forever = async (_u: string, init?: RequestInit) => (init?.method === 'POST' ? start.clone() : reply(200, { job: { id: 'j', status: 'running' } }));
    expect(await postAsJob('/x', {}, { fetch: forever as never, wait, giveUpMs: 4500 })).toEqual({ ok: false, body: { error: 'That took too long — try again.' } });
  });
});
