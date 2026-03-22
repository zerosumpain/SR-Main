import type { RequestHandler } from './$types';
import {
  getSandboxStatus,
  startSandbox,
  stopSandbox,
  buildSandboxImage,
  execInSandbox,
  getDockerContainers,
  getSandboxComponents,
} from '$lib/jkai/sandbox';
import { validateSession } from '$lib/auth';
import { db } from '$lib/db';
import { jkaiComponentUsage } from '$lib/db/schema';
import { sql, eq, desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url, cookies }) => {
  if (!validateSession(cookies.get('admin_session'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const action = url.searchParams.get('action');

  if (action === 'containers') {
    const containers = await getDockerContainers();
    return Response.json(containers);
  }

  if (action === 'components') {
    // Get installed components from sandbox
    const status = await getSandboxStatus();
    if (!status.running) {
      return Response.json({ error: 'Sandbox not running', components: [] });
    }

    const components = await getSandboxComponents();

    // Get usage stats from DB
    const usageStats = await db
      .select({
        component: jkaiComponentUsage.component,
        count: sql<number>`count(*)::int`,
        lastUsed: sql<string>`max(${jkaiComponentUsage.createdAt})`,
        lastContext: sql<string>`(array_agg(${jkaiComponentUsage.context} order by ${jkaiComponentUsage.createdAt} desc))[1]`,
        lastSource: sql<string>`(array_agg(${jkaiComponentUsage.source} order by ${jkaiComponentUsage.createdAt} desc))[1]`,
        cronCount: sql<number>`count(*) filter (where ${jkaiComponentUsage.source} = 'cron')::int`,
      })
      .from(jkaiComponentUsage)
      .groupBy(jkaiComponentUsage.component);

    const usageMap = new Map(usageStats.map((u) => [u.component, u]));

    const enriched = components.map((c) => {
      const usage = usageMap.get(c.name);
      return {
        ...c,
        usageCount: usage?.count ?? 0,
        lastUsed: usage?.lastUsed ?? null,
        lastContext: usage?.lastContext ?? null,
        lastSource: usage?.lastSource ?? null,
        cronCount: usage?.cronCount ?? 0,
      };
    });

    // Sort: used components first (by count desc), then unused alphabetically
    enriched.sort((a, b) => {
      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
      return a.name.localeCompare(b.name);
    });

    return Response.json({ components: enriched });
  }

  const status = await getSandboxStatus();
  return Response.json(status);
};

export const POST: RequestHandler = async ({ request, cookies }) => {
  if (!validateSession(cookies.get('admin_session'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { action, command, timeout } = await request.json();

  switch (action) {
    case 'start': {
      const result = await startSandbox();
      return Response.json(result);
    }
    case 'stop': {
      const result = await stopSandbox();
      return Response.json(result);
    }
    case 'build': {
      const result = await buildSandboxImage();
      return Response.json(result);
    }
    case 'exec': {
      if (!command) {
        return Response.json({ error: 'No command provided' }, { status: 400 });
      }
      const result = await execInSandbox(command, timeout || 30000);
      return Response.json(result);
    }
    default:
      return Response.json({ error: 'Unknown action' }, { status: 400 });
  }
};
