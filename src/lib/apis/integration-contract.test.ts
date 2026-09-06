import { describe, it, expect } from 'vitest';
import { assessOutputs, parameterSchema, resolveParameters, type ParamContract } from './integration-contract';
const params: ParamContract[] = [
  { name: 'station', in: 'path', required: true, type: 'string' },
  { name: 'window', in: 'query', type: 'integer', default: '120' },
  { name: 'direction', in: 'query', enum: ['to', 'from'] },
  { name: 'authorization', in: 'header' },
];
describe('shared integration input contract', () => {
  it('provides a callable schema and validates defaults without exposing headers in scope', () => {
    expect(parameterSchema(params)).toMatchObject({ additionalProperties: false, required: ['station'] });
    expect(resolveParameters(params, { station: 'DAR', authorization: 'private' })).toMatchObject({
      values: { station: 'DAR', window: 120, authorization: 'private' }, scope: { station: 'DAR', window: 120 }, defaultsApplied: ['window'],
    });
  });
  it.each([
    [{ station: 'DAR', typo: 1 }, 'Unknown integration parameter'],
    [{}, 'Missing required'], [{ station: 'DAR', window: '120' }, 'must be integer'],
    [{ station: 'DAR', direction: 'departures' }, 'must be one of'],
  ])('rejects invalid arguments before dispatch: %j', (args, error) => expect(() => resolveParameters(params, args)).toThrow(error));
  it('preserves legacy scalar parameters and explicit suppression of an optional default', () => {
    expect(resolveParameters([{ name: 'limit', in: 'query', default: '10' }], { limit: '' }).values).toEqual({});
    expect(resolveParameters([{ name: 'limit', in: 'query' }], { limit: 0 }).values).toEqual({ limit: 0 });
  });
});
describe('provider-independent response semantics', () => {
  it('does not mistake successful board metadata for a complete response', () => {
    const values = { station: 'Darlington', services: undefined, notices: ['Disruption'] };
    expect(assessOutputs([{ name: 'station' }, { name: 'services' }, { name: 'notices' }], values, { areServicesAvailable: true }))
      .toMatchObject({ outcome: 'incomplete', missingOutputs: ['services'] });
    expect(JSON.parse(JSON.stringify(values))).toHaveProperty('services', null);
  });
  it('only normalizes absent records when the saved contract explicitly permits it', () => {
    expect(assessOutputs([{ name: 'events', type: 'array', emptyWhenMissing: true }], {}, {})).toMatchObject({ outcome: 'empty', emptyOutputs: ['events'] });
    expect(assessOutputs([{ name: 'events', type: 'array' }], {}, {})).toMatchObject({ outcome: 'incomplete' });
    expect(assessOutputs([{ name: 'events', type: 'array', emptyWhenMissing: true }], { events_error: 'projection failed' }, {})).toMatchObject({ outcome: 'incomplete' });
  });
  it('reports empty record outputs even when metadata arrays contain notices', () => {
    expect(assessOutputs([{ name: 'orders' }, { name: 'notices' }], { orders: [], notices: ['Maintenance soon'] }, {})).toMatchObject({ emptyOutputs: ['orders'] });
  });
  it('accepts zero balances and false state, but rejects a changed output shape', () => {
    expect(assessOutputs([{ name: 'balance', type: 'number' }, { name: 'enabled', type: 'boolean' }], { balance: 0, enabled: false }, {}).outcome).toBe('data');
    expect(assessOutputs([{ name: 'accounts', type: 'array' }], { accounts: {} }, {})).toMatchObject({ outcome: 'incomplete', invalidOutputs: ['accounts'] });
  });
});
