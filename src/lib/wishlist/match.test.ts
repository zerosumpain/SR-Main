import { describe, expect, it } from 'vitest';
import { canonicalGpu, parseGpu } from './gpu';
import { parsePounds, parseRam, readSpecs } from './specs';
import { evaluate } from './match';
import type { WishCriteria } from './types';

// Titles are real hotukdeals posts from the gaming-pc tag, 2026-10-26..29.
const PC: WishCriteria = {
  maxPricePence: 110_000,
  nearMissPct: 10,
  constraints: [
    { field: 'gpu', op: 'rank_gte', value: 'RTX 5060' },
    { field: 'ram_gb', op: 'gte', value: 16 },
    { field: 'ram_type', op: 'in', value: ['DDR5'] },
    { field: 'text', op: 'excludes_any', value: ['laptop'] },
  ],
};

describe('GPU reading', () => {
  it('canonicalises the ways listings write a card', () => {
    expect(canonicalGpu('Nvidia GeForce RTX 5060Ti 16GB')).toBe('RTX 5060 TI');
    expect(canonicalGpu('RX 9070 XT 16GB GDDR6')).toBe('RX 9070 XT');
    expect(canonicalGpu('Radeon RX9060XT')).toBe('RX 9060 XT');
    expect(canonicalGpu('RTX 4070 Ti Super')).toBe('RTX 4070 TI SUPER');
    expect(canonicalGpu('Intel Arc B580')).toBe('ARC B580');
    expect(canonicalGpu('Ryzen 7 9700X, 32GB')).toBeNull();
  });

  it('trusts the title over a description that mentions an older card', () => {
    expect(parseGpu('Gaming PC RTX 5070', 'a big step up from the RTX 3060')?.name).toBe('RTX 5070');
  });

  it('refuses to rank a laptop part', () => {
    expect(parseGpu('ASUS TUF laptop RTX 5070')?.score).toBeNull();
  });
});

describe('spec reading', () => {
  it('takes system RAM, not VRAM or storage', () => {
    expect(parseRam('AWD-IT Erebus AMD Ryzen 7, NVIDIA RTX 5060 Ti 8GB, 32GB RAM & 1TB SSD')).toEqual({ gb: 32, type: null });
    expect(parseRam('RX 9070 XT 16GB GDDR6 | 32GB DDR5 6000MHz | 2TB NVMe SSD')).toEqual({ gb: 32, type: 'DDR5' });
    expect(parseRam('Intel Core 5 210H 16GB RAM 512GB SSD RTX 5050')).toEqual({ gb: 16, type: null });
  });

  it('reads storage in GB', () => {
    expect(readSpecs('32GB DDR5 RAM, RTX 5060 Ti, 1TB NVMe SSD').storageGb).toBe(1000);
  });

  it('reads sterling into pence', () => {
    expect(parsePounds('£1,299')).toBe(129_900);
    expect(parsePounds('£829.97 - Laptops Direct')).toBe(82_997);
    expect(parsePounds('£9.5')).toBe(950);
    expect(parsePounds('FREE')).toBeNull();
  });
});

describe('evaluate', () => {
  it('matches a listing that meets every ask', () => {
    const e = evaluate({ title: 'Gaming PC RTX 5060 Ti, 32GB DDR5 RAM, 1TB NVMe', description: '', pricePence: 104_999 }, PC);
    expect(e.verdict).toBe('match');
    expect(e.results.every((r) => r.ok)).toBe(true);
  });

  it('says "possible" when the listing is silent on the RAM generation', () => {
    const e = evaluate({ title: 'Ryzen 7, NVIDIA RTX 5060 Ti 8GB, 32GB RAM & 1TB SSD', description: '', pricePence: 99_999 }, PC);
    expect(e.verdict).toBe('possible');
    expect(e.results.find((r) => r.field === 'ram_type')?.ok).toBeNull();
  });

  it('rejects a weaker GPU and says why', () => {
    const e = evaluate({ title: 'Acer Nitro 16GB RAM DDR5 512GB SSD RTX 5050 Gaming PC', description: '', pricePence: 82_997 }, PC);
    expect(e.verdict).toBe('no');
    expect(e.results.find((r) => r.field === 'gpu')?.reason).toBe('RTX 5050 is below RTX 5060');
  });

  it('calls a small overspend with every spec met a near miss, and a large one no', () => {
    const t = { title: 'CyberPowerPC RTX 5070 32GB DDR5 1TB NVMe', description: '' };
    expect(evaluate({ ...t, pricePence: 119_000 }, PC).verdict).toBe('near');
    expect(evaluate({ ...t, pricePence: 131_900 }, PC).verdict).toBe('no');
  });

  it('does not give the benefit of the doubt on the GPU, or on two unstated specs', () => {
    // Real PriceRunner desktop-category rows from the first live run.
    expect(evaluate({ title: 'Apple Mac mini 12-core CPU 16 GB 256 GB - Silver', description: '16 GB RAM', pricePence: 74_900 }, PC).verdict).toBe('no');
    expect(evaluate({ title: 'XUM CMP Gaming PC Intel i9-9900K RTX 2070 Super 16GB RAM 512GB SSD', description: '', pricePence: 69_999 }, PC).verdict).toBe('no');
    expect(evaluate({ title: 'Stormforce Recoil Gaming PC RTX 5060', description: '', pricePence: 99_900 }, PC).verdict).toBe('no');
    expect(evaluate({ title: 'Stormforce Recoil Ryzen 5 16GB 1TB RTX 5060 Gaming PC', description: 'AMD Ryzen 5, 16 GB RAM, GeForce RTX 5060', pricePence: 109_900 }, PC).verdict).toBe('possible');
  });

  it('honours an exclusion', () => {
    expect(evaluate({ title: 'Gaming laptop RTX 5070 32GB DDR5', description: '', pricePence: 99_900 }, PC).verdict).toBe('no');
  });
});
