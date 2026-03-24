import { startScheduler } from '$lib/health/scheduler';
import { orchestrator } from '$lib/jkai/orchestrator';
import { authHandle, isPublicPath } from '$lib/auth';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';

// Start the health data sync scheduler
startScheduler();

// Recover any in-progress builds on server startup
orchestrator.recoverOnStartup().catch((err) => {
  console.error('[jkai] Failed to recover build on startup:', err);
});

// Route protection — redirect unauthenticated users on protected pages
const protectionHandle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  // Public paths don't need auth
  if (isPublicPath(pathname)) {
    return resolve(event);
  }

  // API routes return 401 instead of redirecting
  if (pathname.startsWith('/api/')) {
    const session = await event.locals.auth();
    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return resolve(event);
  }

  // Page routes redirect to sign-in
  const session = await event.locals.auth();
  if (!session?.user) {
    const callbackUrl = encodeURIComponent(pathname + event.url.search);
    throw redirect(302, `/auth/signin?callbackUrl=${callbackUrl}`);
  }

  return resolve(event);
};

export const handle = sequence(authHandle, protectionHandle);
