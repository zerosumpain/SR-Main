import { describe, it, expect } from 'vitest';
import { whatsappBridgeHeaders } from './whatsapp-bridge';

describe('whatsappBridgeHeaders', () => {
  it('sends the worker token whenever it is configured', () => {
    expect(whatsappBridgeHeaders({ WA_WORKER_TOKEN: 't0k' }, { 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer t0k',
    });
  });

  it('sends no Authorization header before the token exists', () => {
    expect(whatsappBridgeHeaders({}, { 'Content-Type': 'application/json' })).toEqual({ 'Content-Type': 'application/json' });
  });
});
