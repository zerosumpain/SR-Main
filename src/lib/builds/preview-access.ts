/** Display metadata only. The preview gateway still verifies the signed grant. */
export function previewAccess(url: string | null, now = Date.now()) {
  let expiresAt: number | null = null;
  let loopback = false;
  if (url) {
    try {
      const parsed = new URL(url);
      loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      const grant = parsed.searchParams.get('__sr_grant');
      if (grant && grant.length <= 2048) {
        const payload = JSON.parse(atob(grant.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
        if (typeof payload.expires === 'number' && Number.isFinite(payload.expires)) expiresAt = payload.expires;
      }
    } catch { /* Older local previews do not carry a grant. */ }
  }
  return { expiresAt, expired: expiresAt !== null && expiresAt <= now, loopback };
}
