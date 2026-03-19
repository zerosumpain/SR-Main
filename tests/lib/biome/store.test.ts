import { describe, it, expect, vi } from 'vitest';

// Note: Testing .svelte.ts files with $state runes requires Svelte compiler.
// If runes don't work in test context, test the pure logic only.

describe('biome store', () => {
  it('module exports createBiomeStore', async () => {
    // This test verifies the module can be imported
    // Full reactive testing requires a Svelte component context
    const mod = await import('$lib/biome/store.svelte');
    expect(mod.createBiomeStore).toBeDefined();
    expect(typeof mod.createBiomeStore).toBe('function');
  });
});
