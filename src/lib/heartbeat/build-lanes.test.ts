import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  live: null as null | { buildId: string },
  created: [] as unknown[],
}));

vi.mock('$lib/jkai/development-create.server', () => ({
  findBacklogDelivery: vi.fn(async () => h.live),
  createDevelopmentDelivery: vi.fn(async (input: unknown) => {
    h.created.push(input);
    return { buildId: 'b1234567-new' };
  }),
}));

import { liveBuildLanes } from './build-lanes';

const request = {
  title: 'A rail feed', outcome: 'Accepted brief', criteria: ['It lists lines'],
  brief: { constraints: '- Owner only' }, backlogSlug: 'rail',
};

beforeEach(() => {
  h.live = null;
  h.created = [];
});

describe('the delivery lane', () => {
  it('creates an autopilot development delivery that stops at a pull request', async () => {
    const res = await liveBuildLanes().startDelivery!(request);

    expect(res).toEqual({ ref: 'delivery:b1234567-new', label: 'delivery b1234567' });
    expect(h.created).toEqual([{
      ...request, area: 'Platform', releasePolicy: 'pull_request', autopilot: true,
    }]);
  });

  it('hands back the live delivery for the same backlog item instead of paying twice', async () => {
    h.live = { buildId: 'old99999-live' };

    const res = await liveBuildLanes().startDelivery!(request);

    expect(res).toEqual({ ref: 'delivery:old99999-live', label: 'existing delivery old99999', reused: true });
    expect(h.created).toEqual([]);
  });
});
