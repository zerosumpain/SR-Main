// Browser-safe helpers for the owner-reviewed parts of a custom credential.
//
// Keep these separate from credential-requests.ts: that module builds server
// plans and imports registry.ts, which is server-only because it uses the DB
// and node:crypto. The modal imports this file directly.

/** Parse a custom credential's owner-reviewed host field. Custom credentials
 * deliberately accept only bare, concrete API hostnames — no URLs, ports, paths
 * or wildcards — before the registry applies its matching validation on save. */
export function parseCustomAllowedHosts(value: string): string[] {
  const hosts = value
    .split(/[\n,]/)
    .map((host) => host.trim().toLowerCase().replace(/\.+$/, ''))
    .filter(Boolean);
  if (hosts.length === 0) throw new Error('Enter at least one allowed API hostname.');
  if (hosts.some((host) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host))) {
    throw new Error('Allowed hosts must be bare API hostnames, such as api.example.com.');
  }
  return Array.from(new Set(hosts));
}

/** The only custom create payload the browser may send. The API re-sanitises
 * the handle and validates these owner-reviewed hosts before encrypting a value. */
export function customCredentialSavePayload(input: {
  value: string;
  label: string;
  handle: string;
  allowedHosts: string;
}): {
  provider: 'custom';
  value: string;
  label: string;
  suggestedHandle: string;
  allowedHosts: string[];
} {
  return {
    provider: 'custom',
    value: input.value.trim(),
    label: input.label,
    suggestedHandle: input.handle,
    allowedHosts: parseCustomAllowedHosts(input.allowedHosts),
  };
}
