import { describe, expect, it } from 'vitest';
import {
  authorizeActivityRead,
  defaultConsumerGrants,
  type ActivityConsumerGrant,
} from './grant';

function grant(over: Partial<ActivityConsumerGrant> = {}): ActivityConsumerGrant {
  return {
    id: 'grant-1',
    principalId: 'principal-1',
    connectionId: 'connection-1',
    consumer: 'jkai',
    dataClass: 'activity',
    category: null,
    allowed: true,
    version: 1,
    ...over,
  };
}

const request = {
  principalId: 'principal-1',
  connectionId: 'connection-1',
  consumer: 'jkai' as const,
  dataClass: 'activity' as const,
  category: 'gaming',
};

describe('authorizeActivityRead', () => {
  it('fails closed with no grant', () => {
    expect(authorizeActivityRead(request, [])).toEqual({ allowed: false, reason: 'no_grant' });
  });

  it('accepts a connection-wide grant', () => {
    expect(authorizeActivityRead(request, [grant()])).toMatchObject({ allowed: true });
  });

  it('lets a category-specific deny override a broad allow', () => {
    expect(
      authorizeActivityRead(request, [
        grant(),
        grant({ id: 'specific', category: 'gaming', allowed: false, version: 2 }),
      ]),
    ).toEqual({ allowed: false, reason: 'explicit_deny' });
  });

  it('rejects grants belonging to another principal', () => {
    expect(authorizeActivityRead(request, [grant({ principalId: 'principal-2' })])).toEqual({
      allowed: false,
      reason: 'principal_mismatch',
    });
  });
});

describe('defaultConsumerGrants', () => {
  it('keeps workflow, Intel, MCP, raw content and location off', () => {
    const grants = defaultConsumerGrants({
      principalId: 'principal-1',
      connectionId: 'connection-1',
      dataClasses: ['metadata', 'activity', 'raw_content', 'location'],
    });
    const allowed = (consumer: string, dataClass: string) =>
      grants.find((item) => item.consumer === consumer && item.dataClass === dataClass)?.allowed;

    expect(allowed('jkai', 'activity')).toBe(true);
    expect(allowed('daydream', 'metadata')).toBe(true);
    expect(allowed('workflow', 'activity')).toBe(false);
    expect(allowed('intel', 'activity')).toBe(false);
    expect(allowed('mcp', 'activity')).toBe(false);
    expect(allowed('jkai', 'raw_content')).toBe(false);
    expect(allowed('daydream', 'location')).toBe(false);
  });
});
