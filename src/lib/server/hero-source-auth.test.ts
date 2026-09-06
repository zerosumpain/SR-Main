import { describe, expect, it, vi } from 'vitest';
const { owner, prepare, status } = vi.hoisted(() => ({ owner: vi.fn(), prepare: vi.fn(), status: vi.fn() }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: owner }));
vi.mock('$lib/server/hero-sources', () => ({ prepareHeroSource: prepare, heroPreparation: status, restoreBundledHero: vi.fn() }));
import { GET, POST } from '../../routes/admin/content/hero/background/+server';

describe('hero preparation requires owner access', () => {
  it.each([GET, POST])('denies requests without an owner session before touching Drive', async handler => {
    owner.mockResolvedValue(false);
    await expect(handler({} as never)).rejects.toMatchObject({ status: 403 });
    expect(prepare).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });
});
