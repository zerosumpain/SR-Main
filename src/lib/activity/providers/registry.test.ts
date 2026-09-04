import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureActivityProvider } from './fixture/adapter';
import {
  __clearActivityProviders,
  getActivityProvider,
  listActivityProviders,
  registerActivityProvider,
} from './registry';
import { assertProviderCanEmit, validateActivityEvent } from '../contracts';

beforeEach(() => __clearActivityProviders());

describe('activity provider registry', () => {
  it('registers, lists and resolves adapters without exposing hidden providers by default', () => {
    registerActivityProvider(fixtureActivityProvider);
    expect(getActivityProvider('fixture')).toBe(fixtureActivityProvider);
    expect(listActivityProviders()).toEqual([]);
    expect(listActivityProviders({ includeHidden: true })).toHaveLength(1);
  });

  it('rejects duplicate ids', () => {
    registerActivityProvider(fixtureActivityProvider);
    expect(() => registerActivityProvider(fixtureActivityProvider)).toThrow(/already registered/);
  });

  it('emits every evidence mode through deterministic fixture pages', async () => {
    const context = {
      principalId: 'principal-1',
      connectionId: 'connection-1',
      providerId: 'fixture',
      mode: 'api_key' as const,
      scopes: [],
      observedAt: '2026-09-04T12:00:00.000Z',
      cursor: null,
    };
    const pages = [];
    for await (const page of fixtureActivityProvider.sync!(context)) pages.push(page);
    const events = pages.flatMap((page) => page.events);

    expect(pages.map((page) => page.events.length)).toEqual([2, 2, 1]);
    expect(new Set(events.map((event) => event.evidenceMode))).toEqual(
      new Set(fixtureActivityProvider.manifest.evidenceModes),
    );
    for (const event of events) {
      validateActivityEvent(event, context);
      expect(() => assertProviderCanEmit(fixtureActivityProvider.manifest, event)).not.toThrow();
    }
  });
});
