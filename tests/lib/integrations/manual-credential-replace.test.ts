import { describe, expect, it } from 'vitest';
import { buildManualPayload, getManualCredentialSpec } from '$lib/integrations/manual-credentials';

const spec = getManualCredentialSpec('apple-calendar')!;
const stored = { username: 'john@icloud.com', password: 'old-pass' };

describe('buildManualPayload', () => {
  it('needs every field to create', () => {
    expect(buildManualPayload(spec, { username: 'john@icloud.com' })).toEqual({ error: 'App-specific password is required' });
  });

  it('replaces just the password and keeps the Apple ID', () => {
    expect(buildManualPayload(spec, { password: ' new-pass ' }, stored)).toEqual({
      payload: { username: 'john@icloud.com', password: 'new-pass' },
    });
  });

  it('refuses a replacement with nothing in it', () => {
    expect(buildManualPayload(spec, { username: '', password: '' }, stored)).toEqual({ error: 'Enter the new value to replace' });
  });
});
