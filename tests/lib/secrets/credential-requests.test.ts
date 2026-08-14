import { describe, expect, it } from 'vitest';
import {
  customCredentialSavePayload,
  customSpec,
  parseCustomAllowedHosts,
} from '$lib/secrets/credential-requests';

describe('custom credential requests', () => {
  it('prefills the National Rail Darwin hostname from the tool suggestion', () => {
    const spec = customSpec({
      label: 'National Rail Darwin (LDB Webservice) API token',
      suggestedHost: 'realtime.nationalrail.co.uk',
      suggestedHandle: 'national-rail-darwin',
    });

    expect(spec.binding.handle).toBe('national-rail-darwin');
    expect(spec.binding.allowedHosts).toEqual(['realtime.nationalrail.co.uk']);
  });

  it('accepts bare API hosts and rejects URLs, paths, ports and wildcards', () => {
    expect(parseCustomAllowedHosts('REALTIME.NATIONALRAIL.CO.UK, api.example.com.')).toEqual([
      'realtime.nationalrail.co.uk',
      'api.example.com',
    ]);

    for (const invalid of ['https://api.example.com', 'api.example.com/path', 'api.example.com:443', '*.example.com']) {
      expect(() => parseCustomAllowedHosts(invalid)).toThrow(/bare API hostnames/);
    }
  });

  it('builds the custom save payload with the owner-reviewed host binding', () => {
    expect(
      customCredentialSavePayload({
        value: ' darwin-token ',
        label: 'National Rail Darwin (LDB Webservice) API token',
        handle: 'national-rail-darwin',
        allowedHosts: 'realtime.nationalrail.co.uk',
      }),
    ).toEqual({
      provider: 'custom',
      value: 'darwin-token',
      label: 'National Rail Darwin (LDB Webservice) API token',
      suggestedHandle: 'national-rail-darwin',
      allowedHosts: ['realtime.nationalrail.co.uk'],
    });
  });
});
