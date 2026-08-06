import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { probeAll } from '$lib/connectors/probes';
import { needsResync, sortReports } from '$lib/connectors/types';

// Owner-gated by hooks. Every row is probed live on load — the point of this
// page is that it never repeats a stored status column back at you.
//
// The fix buttons are form actions rather than a new /api/connectors route so
// they inherit this page's gate: there is no new authenticated surface to get
// wrong, and nothing here is reachable without already being on the page.
export const load: PageServerLoad = async () => {
  const reports = sortReports(await probeAll());
  const accounts = reports.filter((r) => r.tier === 'account');
  return {
    reports,
    accounts,
    services: reports.filter((r) => r.tier === 'service'),
    attention: needsResync(reports).length,
    counts: {
      broken: reports.filter((r) => r.status === 'broken').length,
      degraded: reports.filter((r) => r.status === 'degraded').length,
      ok: reports.filter((r) => r.status === 'ok').length,
      unconfigured: reports.filter((r) => r.status === 'unconfigured').length,
    },
  };
};

/** Every action reports back on the row it was fired from. */
function done(key: string, message: string) {
  return { ok: true, key, message };
}

export const actions: Actions = {
  /** Pull from Strava or Whoop right now. Incremental — one page, not a backfill. */
  resync: async ({ request }) => {
    const f = await request.formData();
    const key = String(f.get('key') ?? '');
    const service = String(f.get('service') ?? '');
    if (service !== 'strava' && service !== 'whoop') {
      return fail(400, { ok: false, key, error: 'unknown service' });
    }

    const { syncStravaActivities, syncWhoopAll } = await import('$lib/health/sync-service');
    const result =
      service === 'strava'
        ? await syncStravaActivities({ maxPages: 1 })
        : await syncWhoopAll({ maxPages: 1 });

    if (!result.success) {
      return fail(400, {
        ok: false,
        key,
        error: result.errors[0] ?? 'sync failed — see /admin/connections/health for the job log',
      });
    }
    return done(key, `synced ${result.recordsSynced} record${result.recordsSynced === 1 ? '' : 's'}`);
  },

  /** Prove a Gmail account can actually read mail, not just refresh a token. */
  gmailTest: async ({ request }) => {
    const f = await request.formData();
    const key = String(f.get('key') ?? '');
    const id = Number(key.split(':')[1]);
    if (!Number.isFinite(id)) return fail(400, { ok: false, key, error: 'bad account id' });

    const { db } = await import('$lib/db');
    const { gmailAccounts } = await import('$lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [acct] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, id)).limit(1);
    if (!acct) return fail(404, { ok: false, key, error: 'account not found' });

    try {
      const { gmailService } = await import('$lib/workflows/gmail/service');
      const ids = await gmailService.listMessages(acct, 'newer_than:1d', 5);
      return done(key, `read ${ids.length} message${ids.length === 1 ? '' : 's'} from the last day`);
    } catch (err) {
      return fail(400, { ok: false, key, error: err instanceof Error ? err.message : String(err) });
    }
  },

  /** Run an integration adapter's own health check and record the verdict. */
  testIntegration: async ({ request }) => {
    const f = await request.formData();
    const key = String(f.get('key') ?? '');
    const integrationType = String(f.get('integrationType') ?? '');
    const credentialId = String(f.get('credentialId') ?? '');
    if (!integrationType || !credentialId) {
      return fail(400, { ok: false, key, error: 'missing integration or credential' });
    }

    const { getIntegrationAdapter } = await import('$lib/integrations/registry');
    const { updateCredential } = await import('$lib/integrations/credentials');
    const adapter = getIntegrationAdapter(integrationType);
    if (!adapter?.testCredential) {
      return fail(400, { ok: false, key, error: `${integrationType} has no test handler` });
    }

    try {
      await adapter.testCredential(credentialId);
      await updateCredential(credentialId, {
        lastTestedAt: new Date(),
        lastTestStatus: 'ok',
        lastTestError: null,
      });
      return done(key, 'connected — credentials accepted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateCredential(credentialId, {
        lastTestedAt: new Date(),
        lastTestStatus: 'failed',
        lastTestError: msg,
      });
      return fail(400, { ok: false, key, error: msg });
    }
  },

  /**
   * Trade the stored credentials for a live access token.
   *
   * Only ever on an explicit click. TrueLayer rotates its refresh token on
   * every exchange and the new one is written back into the vault row, so this
   * is a write dressed as a test — running it on page load would churn the
   * credential on every visit.
   */
  testOauthSecret: async ({ request }) => {
    const f = await request.formData();
    const key = String(f.get('key') ?? '');
    const provider = String(f.get('provider') ?? '');
    if (provider !== 'truelayer' && provider !== 'paypal') {
      return fail(400, { ok: false, key, error: 'unknown provider' });
    }

    try {
      const { getOAuthAccessToken } = await import('$lib/secrets/oauth-refresh');
      const token = await getOAuthAccessToken(provider);
      return done(key, `exchange succeeded — access token issued (${token.length} chars, not shown)`);
    } catch (err) {
      return fail(400, { ok: false, key, error: err instanceof Error ? err.message : String(err) });
    }
  },
};
