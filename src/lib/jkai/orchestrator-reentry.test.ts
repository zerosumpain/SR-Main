import { afterAll, describe, expect, it, vi } from 'vitest';
vi.stubEnv('JKAI_SERVICE_ROLE', 'builder');
vi.mock('$lib/db', () => ({ db: {} }));
const { orchestrator } = await import('./orchestrator');
afterAll(() => vi.unstubAllEnvs());

describe('continuation while a paused attempt is still closing', () => {
  for (const [method, kind] of [['startBuild', 'start'], ['restartBuild', 'restart'], ['resumeBuild', 'resume']] as const) {
    it(`${kind} queues without reclaiming the closing attempt's ownership`, async () => {
      // Exercise the production entry point without starting a model or a DB job.
      const controller = Object.assign(Object.create(Object.getPrototypeOf(orchestrator)), {
        activeBuildId: null, iteratingBuildId: 'closing-build', stopped: true,
        dequeueing: false, enqueue: vi.fn(async () => {}),
      });
      await controller[method]('closing-build');
      expect(controller.enqueue).toHaveBeenCalledWith('closing-build', { kind });
      expect(controller.activeBuildId).toBeNull();
      expect(controller.stopped).toBe(true);
    });
  }
});
