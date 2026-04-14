import { db } from '$lib/db';
import { blogPosts, jkaiBuilds, researchSessions } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

type ToolResult = { success: boolean; data?: unknown; error?: string };

export async function executeSiteTool(
  fnName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    switch (fnName) {
      case 'site_health_stats': {
        const { getStats } = await import('$lib/health/stats-service');
        return { success: true, data: await getStats() };
      }
      case 'site_health_readiness': {
        const { getReadiness } = await import('$lib/health/readiness-service');
        return { success: true, data: await getReadiness() };
      }
      case 'site_health_sleep': {
        const { getSleepAnalysis } = await import('$lib/health/sleep-analysis-service');
        return { success: true, data: await getSleepAnalysis() };
      }
      case 'site_health_training_load': {
        const { getTrainingLoad } = await import('$lib/health/training-load-service');
        return { success: true, data: await getTrainingLoad() };
      }
      case 'site_health_timeline': {
        const { getTimeline } = await import('$lib/health/timeline-service');
        const page = (args.page as number) || 1;
        const limit = (args.limit as number) || 20;
        return { success: true, data: await getTimeline(page, limit) };
      }
      case 'site_blog_list': {
        const rows = await db
          .select()
          .from(blogPosts)
          .orderBy(desc(blogPosts.createdAt))
          .limit(50);
        return { success: true, data: rows };
      }
      case 'jkai_list_builds': {
        const rows = await db
          .select()
          .from(jkaiBuilds)
          .orderBy(desc(jkaiBuilds.createdAt))
          .limit(50);
        return { success: true, data: rows };
      }
      case 'research_list': {
        const rows = await db
          .select()
          .from(researchSessions)
          .orderBy(desc(researchSessions.createdAt))
          .limit(50);
        return { success: true, data: rows };
      }
      default:
        return { success: false, error: `Unknown tool: ${fnName}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
