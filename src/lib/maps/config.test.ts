import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isMapboxPublicToken } from './config';

const credentials = vi.hoisted(() => ({ listCredentials: vi.fn(), getCredential: vi.fn() }));
vi.mock('$lib/integrations/credentials', () => credentials);
import { mapboxConfig } from './config.server';
import { GET } from '../../routes/api/maps/config/+server';

describe('Mapbox browser credential boundary', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(['sk.secret.signature', '', 'pk.', 'pk.a.b?secret=x', null, {}])('rejects non-public or malformed tokens', (value) => {
    expect(isMapboxPublicToken(value)).toBe(false);
  });
  it('uses the newest credential and exposes only browser config', async () => {
    credentials.listCredentials.mockResolvedValue([{ id: 'old', createdAt: new Date(0) }, { id: 'new', createdAt: new Date(1) }]);
    credentials.getCredential.mockResolvedValue({ integrationType: 'mapbox', kind: 'apikey', payload: { key: 'pk.public.signature' }, metadata: { private: true } });
    const config = await mapboxConfig();
    expect(credentials.listCredentials).toHaveBeenCalledWith('mapbox');
    expect(credentials.getCredential).toHaveBeenCalledWith('new');
    expect(config).toEqual({ accessToken: 'pk.public.signature', style: 'mapbox://styles/mapbox/outdoors-v12' });
  });
  it('never publishes a secret token even if one is already stored', async () => {
    credentials.listCredentials.mockResolvedValue([{ id: 'bad', createdAt: new Date() }]);
    credentials.getCredential.mockResolvedValue({ integrationType: 'mapbox', kind: 'apikey', payload: { key: 'sk.secret.signature' } });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).not.toContain('sk.secret');
  });
  it('reports missing credentials without leaking storage errors', async () => {
    credentials.listCredentials.mockRejectedValue(new Error('private database details'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private database');
  });
});
