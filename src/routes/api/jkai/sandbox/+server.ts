import type { RequestHandler } from './$types';
import {
  getSandboxStatus,
  startSandbox,
  stopSandbox,
  buildSandboxImage,
  execInSandbox,
  getDockerContainers,
} from '$lib/jkai/sandbox';
import { validateSession } from '$lib/auth';

export const GET: RequestHandler = async ({ url, cookies }) => {
  if (!validateSession(cookies.get('admin_session'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const action = url.searchParams.get('action');

  if (action === 'containers') {
    const containers = await getDockerContainers();
    return Response.json(containers);
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
