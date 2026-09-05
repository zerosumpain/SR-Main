/**
 * Where a provider's APPLICATION secret may come from.
 *
 * Manifests name their required secrets as environment variables, which is
 * how they were first wired: `STEAM_WEB_API_KEY` in `.env`. On the VPS that
 * file is `chattr +i` and editing it means a shell, a restart and a deploy
 * window — so in practice no provider ever got its key, and every catalogue
 * card sat on "operator setup required".
 *
 * The site already has the right home for a key jkai uses but must never
 * read: the secrets vault (`api_secrets`, `$lib/secrets/registry`). This map
 * says which env names have a vault handle. A secret counts as configured if
 * EITHER store has it; the adapter prefers the environment when both do, so a
 * host that was set up the old way keeps working unchanged.
 */
import { getSecretMeta } from '$lib/secrets/registry';
import { STEAM_WEB_API_ENV, STEAM_WEB_API_SECRET_HANDLE } from './steam/credential';

export type ActivitySecretSource = 'env' | 'vault';

/** Env var name → vault handle, for the secrets the vault may hold. */
export const ACTIVITY_SECRET_VAULT_HANDLES: Readonly<Record<string, string>> = {
  [STEAM_WEB_API_ENV]: STEAM_WEB_API_SECRET_HANDLE,
};

export interface ActivitySecretState {
  /** The env var name the manifest uses. Not secret. */
  name: string;
  configured: boolean;
  source: ActivitySecretSource | null;
  /** True when this secret can be entered from the UI rather than `.env`. */
  vaultManaged: boolean;
  /** Why a vault row that exists still cannot be used on this host. */
  unavailableReason?: string;
}

/**
 * The vault's own master key. Without it a vault row cannot be written or
 * read on this host, so the guided setup must not offer the paste form and
 * the catalogue must not count a vault row as configured.
 */
export function vaultKeyConfigured(): boolean {
  return /^[0-9a-f]{64}$/i.test(process.env.INTEGRATION_CREDENTIALS_KEY ?? '');
}

export async function activitySecretState(name: string): Promise<ActivitySecretState> {
  const handle = ACTIVITY_SECRET_VAULT_HANDLES[name];
  if (process.env[name]) {
    return { name, configured: true, source: 'env', vaultManaged: Boolean(handle) };
  }
  if (!handle) return { name, configured: false, source: null, vaultManaged: false };
  const vaultManaged = vaultKeyConfigured();
  if (!vaultManaged) {
    return {
      name,
      configured: false,
      source: null,
      vaultManaged: false,
      unavailableReason: 'The server has no INTEGRATION_CREDENTIALS_KEY, so the vault cannot hold this key.',
    };
  }
  let meta: Awaited<ReturnType<typeof getSecretMeta>> = null;
  try {
    meta = await getSecretMeta(handle);
  } catch {
    // A host with no database (some unit tests) simply has no vault.
    meta = null;
  }
  if (!meta) return { name, configured: false, source: null, vaultManaged };
  // A row that exists but cannot be decrypted here (the master key differs
  // between homeserv and the VPS) is not configured — it would pass every
  // guard and fail on the first sync.
  if (!meta.available) {
    return {
      name,
      configured: false,
      source: null,
      vaultManaged,
      unavailableReason: meta.unavailableReason ?? 'The stored key cannot be read on this host. Re-enter it.',
    };
  }
  return { name, configured: true, source: 'vault', vaultManaged };
}

export async function isActivitySecretConfigured(name: string): Promise<boolean> {
  return (await activitySecretState(name)).configured;
}
