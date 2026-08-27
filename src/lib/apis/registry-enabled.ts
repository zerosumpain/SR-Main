// src/lib/apis/registry-enabled.ts
//
// The API registry — `api_catalog`, `api_integrations` and the `api_secrets`
// table behind them — is a PRODUCTION concern. It exists so jkai can call
// external APIs with credentials it uses but cannot read.
//
// homeserv had a second copy of all of it, and a duplicate registry is not
// merely redundant, it is actively harmful:
//
//   - Both hosts held a `truelayer-oauth` vault row for the SAME TrueLayer
//     client, and TrueLayer rotates the refresh token on every exchange.
//     `listSecrets()` resolves each ref row to compute its `available` flag,
//     and for TrueLayer that resolver performs a live token exchange and
//     persists the rotated credential — so merely LOADING /admin/ai/apis on
//     homeserv could invalidate production's refresh token. The in-process
//     de-duplication in the OAuth helper cannot span two hosts.
//   - The two hosts encrypt with different INTEGRATION_CREDENTIALS_KEYs, so
//     neither is a usable backup of the other. Divergence is silent.
//   - jkai chat already reads production's registry: the MCP client's
//     upstream is https://strangeramblings.com/api/mcp. homeserv's copy served
//     nothing, while /admin/ai/apis on homeserv:5173 still rendered it — a
//     stale view that reads as authoritative.
//
// So homeserv sets API_REGISTRY_DISABLED=1 and grows no registry at all: the
// boot seeder skips the catalogue, and the lazy `ensureIntegrationsCollection`
// stops recreating the integrations collection on the next read. Both read
// paths already treat a missing collection as empty, so nothing has to change
// at the call sites.
//
// This is an env flag rather than an `os.hostname() === 'homeserv'` check on
// purpose: a hostname test ships to production and would misfire on any machine
// that happens to be called homeserv, including in CI.

/**
 * True when this host must hold no API registry at all.
 *
 * Set `API_REGISTRY_DISABLED=1` in the environment (homeserv's `.env`) to
 * opt a host out. Unset — the production default — leaves every behaviour
 * exactly as it was.
 */
export function apiRegistryDisabled(): boolean {
  return process.env.API_REGISTRY_DISABLED === '1';
}
