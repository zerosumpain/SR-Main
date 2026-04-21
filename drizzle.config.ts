import { defineConfig } from 'drizzle-kit';

// DATABASE_URL is pre-loaded from .env by the caller (deploy.sh, `npm run`, etc.)
const url =
  process.env.DATABASE_URL ??
  'postgresql://app:test@localhost:5433/strange_rambling';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema.ts',
  dbCredentials: { url },
});
