import { beforeEach, describe, expect, it, vi } from 'vitest';
const { call, row, update } = vi.hoisted(() => ({
  call: vi.fn(), update: vi.fn(async () => ({ id: 'row' })),
  row: { name: 'Fixture operation', api: 'fixture', method: 'GET', path: '/records/{station}', params: [{ name: 'station', in: 'path', required: true, type: 'string' }], outputs: [{ name: 'records', expr: 'json.records', type: 'array' }] },
}));
vi.mock('$lib/datastore', () => ({ DatastoreError: class extends Error {}, ensureCollection: vi.fn(), getRecordByKey: vi.fn(async () => ({ key: 'fixture', data: row })), queryRecords: vi.fn(async () => ({ records: [] })), updateRecord: update, upsertRecord: vi.fn(), deleteRecord: vi.fn() }));
vi.mock('$lib/workflows/site-tools/tools/apis', () => ({ callCatalogApi: call, slugifyName: (s: string) => s.toLowerCase() }));
import { callIntegration } from './integrations';
import { handleIntegrationCall } from '$lib/workflows/site-tools/tools/api-integrations';
beforeEach(() => { call.mockReset(); update.mockClear(); });
describe('saved integration dispatch boundary', () => {
  it('rejects unknown parameters without contacting the provider and supplies the repair schema', async () => {
    const result = await handleIntegrationCall({ key: 'fixture', params: { station: 'DAR', typo: true } });
    expect(result).toMatchObject({ success: false, data: { outcome: 'invalid_parameters', inputSchema: { required: ['station'], additionalProperties: false } } });
    expect(call).not.toHaveBeenCalled();
  });
  it('passes validated parameters to exactly the saved endpoint', async () => {
    call.mockResolvedValue({ success: true, data: { status: 200, json: { records: [] } } });
    const result = await callIntegration({ key: 'fixture', params: { station: 'DAR' } });
    expect(call).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ api: 'fixture', path: '/records/DAR', method: 'GET' }));
    expect(result.response).toMatchObject({ outcome: 'empty', scope: { station: 'DAR' } });
  });
  it('does not verify incomplete HTTP-success responses', async () => {
    call.mockResolvedValue({ success: true, data: { status: 200, json: { available: true } } });
    const result = await callIntegration({ key: 'fixture', params: { station: 'DAR' } });
    expect(result).toMatchObject({ success: true, values: { records: null }, response: { outcome: 'incomplete', missingOutputs: ['records'] } });
    expect(update).not.toHaveBeenCalled();
  });
});
