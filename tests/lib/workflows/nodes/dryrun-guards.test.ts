import { describe, it, expect } from 'vitest';
import { getDefinition } from '$lib/workflows/registry-client';
import { hasSideEffects } from '$lib/workflows/side-effects';

/**
 * Test runs stub side effects in the ENGINE, from each definition's
 * `sideEffects` — no longer node by node. The per-node `dryRun` branches this
 * file used to guard are gone: three nodes (builder-canvas, file-build,
 * apple-calendar) never had one, so a "dry" run really built, wrote and booked.
 *
 * This is the guard now: every way a node can send, write, book, build or
 * spend is DECLARED, and every read is not (a test run should read for real).
 * A new side-effecting node that forgets `sideEffects` would run for real in a
 * test run — add it here when you add it.
 */

const WRITES: Array<[string, Record<string, unknown>]> = [
  ['whatsapp', {}], ['notify', {}], ['email', {}],
  ['gmail-send', {}], ['gmail-reply', {}], ['gmail-label', {}],
  ['intel-write', {}], ['deck-build', {}], ['builder-chat', {}], ['builder-pi', {}],
  ['infrastructure-update', {}], ['delegate-agent', {}], ['site-tool', { toolName: 'save_memory' }],
  ['file-write', {}], ['file-delete', {}], ['file-build', { persist: true }],
  ['blog-create', {}], ['blog-update', {}], ['blog', { operation: 'create' }], ['blog', { operation: 'update' }],
  ['deep-dive-start', {}], ['deep-dive-control', {}], ['deep-dive', { operation: 'start' }],
  ['jkai', { operation: 'start' }], ['jkai', { operation: 'control' }],
  ['home-assistant', { operation: 'call_service' }], ['home-assistant', { operation: 'fire_event' }],
  ['apple-calendar', { operation: 'create' }], ['apple-calendar', { operation: 'update' }], ['apple-calendar', { operation: 'delete' }],
  ['data-store', { operation: 'set' }], ['data-store', { operation: 'append' }], ['data-store', { operation: 'increment' }],
  ['data-store', { operation: 'delete' }], ['database', { operation: 'insert' }], ['database', { operation: 'delete' }],
  ['file-store', { operation: 'write' }], ['file-store', { operation: 'delete' }],
  ['http-request', { method: 'POST' }], ['http-request', { method: 'delete' }],
  ['api-call', { method: 'PATCH' }], ['api-integration', { confirmWrite: true }],
];

const READS: Array<[string, Record<string, unknown>]> = [
  ['http-request', { method: 'GET' }], ['http-request', {}], ['api-call', { method: 'GET' }], ['api-integration', {}],
  ['data-store', { operation: 'get' }], ['data-store', {}], ['database', { operation: 'query' }],
  ['home-assistant', { operation: 'query_state' }], ['apple-calendar', { operation: 'list' }],
  ['blog', { operation: 'list' }], ['jkai', { operation: 'status' }], ['file-read', {}], ['file-build', { persist: false }],
  ['llm-call', {}], ['transform', {}], ['code-execute', {}], ['conditional', {}], ['tavily-search', {}], ['build-view', {}],
];

describe('side effects are declared, so a test run stubs them', () => {
  it.each(WRITES)('%s %j is a side effect', (type, config) => {
    expect(getDefinition(type), `no definition for ${type}`).toBeDefined();
    expect(hasSideEffects(getDefinition(type), config)).toBe(true);
  });

  it.each(READS)('%s %j is not — a test run runs it for real', (type, config) => {
    expect(getDefinition(type), `no definition for ${type}`).toBeDefined();
    expect(hasSideEffects(getDefinition(type), config)).toBe(false);
  });
});
