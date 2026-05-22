import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock health services
vi.mock('$lib/health/stats-service', () => ({
  getStats: vi.fn(),
}));
vi.mock('$lib/health/readiness-service', () => ({
  getReadiness: vi.fn(),
}));
vi.mock('$lib/health/sleep-analysis-service', () => ({
  getSleepAnalysis: vi.fn(),
}));
vi.mock('$lib/health/training-load-service', () => ({
  getTrainingLoad: vi.fn(),
}));
vi.mock('$lib/health/timeline-service', () => ({
  getTimeline: vi.fn(),
}));

// Mock DB. The real $lib/db/schema is left unmocked so every table export
// resolves — the mocked db.select() chain ignores the table arg anyway.
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

// We need to mock drizzle query builder pattern: db.select().from(table).where(...)
import { getStats } from '$lib/health/stats-service';
import { getReadiness } from '$lib/health/readiness-service';
import { getSleepAnalysis } from '$lib/health/sleep-analysis-service';
import { getTrainingLoad } from '$lib/health/training-load-service';
import { getTimeline } from '$lib/health/timeline-service';
import { db } from '$lib/db';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';

const mockedGetStats = vi.mocked(getStats);
const mockedGetReadiness = vi.mocked(getReadiness);
const mockedGetSleepAnalysis = vi.mocked(getSleepAnalysis);
const mockedGetTrainingLoad = vi.mocked(getTrainingLoad);
const mockedGetTimeline = vi.mocked(getTimeline);
const mockedDb = vi.mocked(db, true);

function mockDbChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(result),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result),
      }),
      then: undefined as any,
    }),
  };
  // Make from() result also thenable for cases without orderBy/where
  const fromResult = chain.from();
  fromResult.then = (resolve: any) => Promise.resolve(result).then(resolve);
  chain.from.mockReturnValue(fromResult);
  mockedDb.select.mockReturnValue(chain as any);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeSiteTool', () => {
  describe('health_stats', () => {
    it('calls getStats and returns data', async () => {
      const statsData = { weeklyDistance: 42, activities: 5 };
      mockedGetStats.mockResolvedValue(statsData as any);

      const result = await executeSiteTool('health_stats', {});

      expect(mockedGetStats).toHaveBeenCalledOnce();
      expect(result).toEqual({ success: true, data: statsData });
    });
  });

  describe('health_readiness', () => {
    it('calls getReadiness and returns data', async () => {
      const readinessData = { score: 85, label: 'Good' };
      mockedGetReadiness.mockResolvedValue(readinessData as any);

      const result = await executeSiteTool('health_readiness', {});

      expect(mockedGetReadiness).toHaveBeenCalledOnce();
      expect(result).toEqual({ success: true, data: readinessData });
    });
  });

  describe('health_sleep', () => {
    it('calls getSleepAnalysis and returns data', async () => {
      const sleepData = { duration: 7.5, score: 88 };
      mockedGetSleepAnalysis.mockResolvedValue(sleepData as any);

      const result = await executeSiteTool('health_sleep', {});

      expect(mockedGetSleepAnalysis).toHaveBeenCalledOnce();
      expect(result).toEqual({ success: true, data: sleepData });
    });
  });

  describe('health_training_load', () => {
    it('calls getTrainingLoad and returns data', async () => {
      const loadData = { acwr: 1.1, zone: 'optimal' };
      mockedGetTrainingLoad.mockResolvedValue(loadData as any);

      const result = await executeSiteTool('health_training_load', {});

      expect(mockedGetTrainingLoad).toHaveBeenCalledOnce();
      expect(result).toEqual({ success: true, data: loadData });
    });
  });

  describe('health_timeline', () => {
    it('calls getTimeline with page and limit args', async () => {
      const timelineData = { events: [], hasMore: false };
      mockedGetTimeline.mockResolvedValue(timelineData as any);

      const result = await executeSiteTool('health_timeline', { page: 2, limit: 10 });

      expect(mockedGetTimeline).toHaveBeenCalledWith(2, 10);
      expect(result).toEqual({ success: true, data: timelineData });
    });

    it('uses defaults when args omitted', async () => {
      const timelineData = { events: [], hasMore: true };
      mockedGetTimeline.mockResolvedValue(timelineData as any);

      const result = await executeSiteTool('health_timeline', {});

      expect(mockedGetTimeline).toHaveBeenCalledWith(1, 20);
      expect(result).toEqual({ success: true, data: timelineData });
    });
  });

  describe('blog_list', () => {
    it('queries blogPosts from DB', async () => {
      const posts = [{ id: '1', title: 'Test Post', status: 'published' }];
      mockDbChain(posts);

      const result = await executeSiteTool('blog_list', {});

      expect(mockedDb.select).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: posts });
    });
  });

  describe('build_list', () => {
    it('queries jkaiBuilds from DB', async () => {
      const builds = [{ id: '1', status: 'completed', title: 'Timer App' }];
      mockDbChain(builds);

      const result = await executeSiteTool('build_list', {});

      expect(mockedDb.select).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: builds });
    });
  });

  describe('research_list', () => {
    it('queries researchSessions from DB', async () => {
      const sessions = [{ id: '1', topic: 'AI Safety', status: 'completed' }];
      mockDbChain(sessions);

      const result = await executeSiteTool('research_list', {});

      expect(mockedDb.select).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: sessions });
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeSiteTool('nonexistent_tool', {});

      expect(result).toEqual({
        success: false,
        error: 'Unknown tool: nonexistent_tool',
      });
    });
  });

  describe('error handling', () => {
    it('catches and returns service errors gracefully', async () => {
      mockedGetStats.mockRejectedValue(new Error('DB connection failed'));

      const result = await executeSiteTool('health_stats', {});

      expect(result).toEqual({
        success: false,
        error: 'DB connection failed',
      });
    });

    it('handles non-Error thrown values', async () => {
      mockedGetReadiness.mockRejectedValue('unexpected string error');

      const result = await executeSiteTool('health_readiness', {});

      expect(result).toEqual({
        success: false,
        error: 'Unknown error',
      });
    });
  });
});
