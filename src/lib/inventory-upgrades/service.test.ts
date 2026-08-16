import { describe, expect, it } from 'vitest';
import type { Installation, ReleaseNotes, UpgradeRepository } from '$lib/inventory-upgrades/repository';
import { UpgradeAnalysisService } from '$lib/inventory-upgrades/service';

class MemoryRepository implements UpgradeRepository {
  installations = new Map<string, Installation>();
  notes = new Map<string, ReleaseNotes>();

  async saveInstallation(value: Installation): Promise<void> {
    this.installations.set(`${value.component}:${value.environment}`, value);
  }

  async findInstallation(component: string, environment: string): Promise<Installation | null> {
    return this.installations.get(`${component}:${environment}`) ?? null;
  }

  async saveReleaseNotes(value: ReleaseNotes): Promise<void> {
    this.notes.set(`${value.component}:${value.version}`, value);
  }

  async findReleaseNotes(component: string, version: string): Promise<ReleaseNotes | null> {
    return this.notes.get(`${component}:${version}`) ?? null;
  }
}

describe('UpgradeAnalysisService', () => {
  it('persists fetched notes and flags a major upgrade with breaking changes', async () => {
    const repository = new MemoryRepository();
    const service = new UpgradeAnalysisService(repository, {
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => '# v2.0.0\n\nBreaking: migrate configuration to the new format.'
      })
    });

    await service.recordInstallation({ component: 'api', environment: 'production', version: '1.4.2' });
    const notes = await service.refreshReleaseNotes('api', '2.0.0', 'https://example.test/releases/2.0.0');
    const plan = await service.prepareUpgrade({ component: 'api', environment: 'production', targetVersion: '2.0.0' });

    expect(notes.breakingChanges).toHaveLength(1);
    expect(plan.status).toBe('needs-review');
    expect(plan.assessment.reasons).toContain('The upgrade crosses a major-version boundary.');
    expect(plan.steps.some((step) => step.includes('staging'))).toBe(true);
  });

  it('blocks a downgrade', async () => {
    const repository = new MemoryRepository();
    const service = new UpgradeAnalysisService(repository, { fetch: async () => ({ ok: true, status: 200, text: async () => 'notes' }) });
    await service.recordInstallation({ component: 'worker', environment: 'production', version: '3.1.0' });

    const plan = await service.prepareUpgrade({ component: 'worker', environment: 'production', targetVersion: '3.0.0' });

    expect(plan.status).toBe('blocked');
    expect(plan.assessment.status).toBe('incompatible');
  });
});
