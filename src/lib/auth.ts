import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import { env } from '$env/dynamic/private';
import type { Handle } from '@sveltejs/kit';

// Allowed email addresses (only these users can sign in)
function getAllowedEmails(): string[] {
  const emails = env.AUTH_ALLOWED_EMAILS || '';
  return emails.split(',').map((e) => e.trim()).filter(Boolean);
}

export const { handle: authHandle, signIn, signOut } = SvelteKitAuth({
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: env.AUTH_SECRET,
  trustHost: true,
  callbacks: {
    async signIn({ profile }) {
      const allowed = getAllowedEmails();
      if (allowed.length === 0) return true; // no restriction if not configured
      return allowed.includes(profile?.email || '');
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
});

// Routes that don't require authentication
const PUBLIC_PATHS = [
  '/',
  '/blog',
  '/writing',
  '/rss.xml',
  '/sitemap.xml',
  '/auth',
  '/api/auth',
  '/api/biome/state',
  '/api/biome/config',
  '/api/health/apple',
  '/api/agent',
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// Check if a request is authenticated (for use in API routes)
export async function isAuthenticated(locals: App.Locals): Promise<boolean> {
  const session = await locals.auth();
  return !!session?.user;
}
