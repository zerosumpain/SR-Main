import { describe, expect, it, vi } from 'vitest';
import { api, cancelJob, errorText, jobTripId, watchJob } from './decisions-client';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wait = async () => {};

describe('api', () => {
  it('sends JSON and never throws on a dropped connection', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ action: 'accept' });
      return reply(200, { planVersion: 13 });
    });
    expect(await api('POST', '/api/trips/t/proposals/p', { action: 'accept' }, f as never)).toEqual({ ok: true, status: 200, body: { planVersion: 13 } });
    const down = async () => {
      throw new TypeError('network');
    };
    const r = await api('GET', '/x', undefined, down as never);
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(errorText(r)).toBe('The site did not answer. Try again.');
  });

  it('says the server’s own words, else something plain', () => {
    expect(errorText({ ok: false, status: 409, body: { error: 'No longer open.' } })).toBe('No longer open.');
    expect(errorText({ ok: false, status: 404, body: {} })).toBe('The site does not know how to do that yet.');
    expect(errorText({ ok: false, status: 500, body: {} }, 'Could not.')).toBe('Could not.');
  });
});

describe('watchJob', () => {
  it('hands every poll to the page and ends on done', async () => {
    const polls = [
      reply(200, { job: { id: 'j', status: 'running', tripId: null, stages: [{ key: 'brief', label: 'Setting up', state: 'running', detail: null }], result: null, error: null } }),
      reply(200, { job: { id: 'j', status: 'running', tripId: 't1', stages: [{ key: 'brief', label: 'Setting up', state: 'done', detail: 'Rome' }], result: { id: 't1' }, error: null } }),
      reply(200, { job: { id: 'j', status: 'done', tripId: 't1', stages: [], result: { id: 't1' }, error: null } }),
    ];
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('/api/trips/jobs/j');
      return polls.shift()!;
    });
    const seen: string[] = [];
    const end = await watchJob('j', { fetch: f as never, wait, onUpdate: (j) => seen.push(`${j.status}:${j.tripId}`) });
    expect(end.status).toBe('done');
    expect(seen).toEqual(['running:null', 'running:t1', 'done:t1']);
    expect(jobTripId(end)).toBe('t1');
  });

  it('ends on cancelled and failed with the job’s own words, and says when a job is lost', async () => {
    const cancelled = async () => reply(200, { job: { id: 'j', status: 'cancelled', result: null, error: null } });
    expect((await watchJob('j', { fetch: cancelled as never, wait })).status).toBe('cancelled');
    const failed = async () => reply(200, { job: { id: 'j', status: 'failed', result: null, error: 'The server restarted — try again' } });
    expect((await watchJob('j', { fetch: failed as never, wait })).error).toBe('The server restarted — try again');
    const lost = async () => reply(404, { error: 'gone' });
    expect((await watchJob('j', { fetch: lost as never, wait })).error).toMatch(/lost in an update/);
  });

  it('keeps polling through blips, stops when the page goes, and gives up kindly', async () => {
    let n = 0;
    const blip = async () => {
      n += 1;
      if (n === 1) throw new TypeError('network');
      if (n === 2) return reply(502, {});
      return reply(200, { job: { id: 'j', status: 'done', result: { id: 't' }, error: null } });
    };
    expect((await watchJob('j', { fetch: blip as never, wait })).status).toBe('done');
    const signal = { aborted: true };
    const never = vi.fn(async () => reply(200, { job: { id: 'j', status: 'running' } }));
    expect((await watchJob('j', { fetch: never as never, wait, signal })).status).toBe('failed');
    expect(never).not.toHaveBeenCalled();
    const forever = async () => reply(200, { job: { id: 'j', status: 'running', result: null, error: null } });
    const slow = await watchJob('j', { fetch: forever as never, wait, giveUpMs: 4500 });
    expect(slow.status).toBe('failed');
    expect(slow.error).toMatch(/may still finish/);
  });
});

describe('cancelJob and jobTripId', () => {
  it('cancels with DELETE on the jobs route', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/trips/jobs/j%2F1');
      expect(init?.method).toBe('DELETE');
      return reply(200, { job: { id: 'j/1', status: 'cancelled', result: null, error: null } });
    });
    expect((await cancelJob('j/1', '/api/trips', f as never)).body.job?.status).toBe('cancelled');
  });

  it('finds the trip a start job made, from tripId or the result', () => {
    expect(jobTripId({ tripId: 'a', result: null })).toBe('a');
    expect(jobTripId({ tripId: null, result: { id: 'b' } })).toBe('b');
    expect(jobTripId({ tripId: undefined, result: null })).toBeNull();
  });
});
