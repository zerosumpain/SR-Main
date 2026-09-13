import { describe, it, expect, vi, beforeEach } from 'vitest';

// The health tools no longer call a service in this process — Health is its own
// application, and they go over the gateway's service lane. So the mock moved
// down a layer, and what these tests now pin is the thing that can actually
// break: WHICH endpoint each tool asks for. A tool quietly pointed at the wrong
// path would return somebody else's JSON and the model would read it as fact.
vi.mock('$lib/server/extracted-app', () => ({
  getFromExtracted: vi.fn(),
  postToExtracted: vi.fn(),
  ExtractedAppError: class ExtractedAppError extends Error {},
}));

// Mock DB. The real $lib/db/schema is left unmocked so every table export
// resolves — the mocked db.select() chain ignores the table arg anyway.
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

// We need to mock drizzle query builder pattern: db.select().from(table).where(...)
import { getFromExtracted } from '$lib/server/extracted-app';
import { db } from '$lib/db';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';

const mockedGet = vi.mocked(getFromExtracted);
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
  describe.each([
    ['health_stats', '/api/health/stats', { weeklyDistance: 42, activities: 5 }],
    ['health_readiness', '/api/health/readiness', { score: 85, label: 'Good' }],
    ['health_sleep', '/api/health/sleep', { duration: 7.5, score: 88 }],
    ['health_training_load', '/api/health/training-load', { acwr: 1.1, zone: 'optimal' }],
  ])('%s', (tool, path, payload) => {
    it(`asks Health for ${'$'}{path} and passes the body straight back`, async () => {
      mockedGet.mockResolvedValue(payload as never);

      const result = await executeSiteTool(tool, {});

      expect(mockedGet).toHaveBeenCalledOnce();
      expect(mockedGet).toHaveBeenCalledWith('health', path);
      // Unprojected on purpose: the consumer is a language model reading JSON,
      // so this tool never indexes a field and has no shape to pin.
      expect(result).toEqual({ success: true, data: payload });
    });
  });

  describe('health_timeline', () => {
    it('passes page and limit through as query parameters', async () => {
      const timelineData = { events: [], hasMore: false };
      mockedGet.mockResolvedValue(timelineData as never);

      const result = await executeSiteTool('health_timeline', { page: 2, limit: 10 });

      expect(mockedGet).toHaveBeenCalledWith('health', '/api/health/timeline?page=2&limit=10');
      expect(result).toEqual({ success: true, data: timelineData });
    });

    it('uses defaults when args omitted', async () => {
      const timelineData = { events: [], hasMore: true };
      mockedGet.mockResolvedValue(timelineData as never);

      const result = await executeSiteTool('health_timeline', {});

      expect(mockedGet).toHaveBeenCalledWith('health', '/api/health/timeline?page=1&limit=20');
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
    it('turns an unreachable Health into a tool error, not a crash', async () => {
      // This is the state the extraction created: before, the service was in
      // this process and could only fail by throwing. Now the other application
      // can simply be down. executeSiteTool catching it is what keeps that a
      // sentence the model can act on.
      mockedGet.mockRejectedValue(new Error('DB connection failed'));

      const result = await executeSiteTool('health_stats', {});

      expect(result).toEqual({
        success: false,
        error: 'DB connection failed',
      });
    });

    it('handles non-Error thrown values', async () => {
      mockedGet.mockRejectedValue('unexpected string error');

      const result = await executeSiteTool('health_readiness', {});

      expect(result).toEqual({
        success: false,
        error: 'Unknown error',
      });
    });
  });
});
