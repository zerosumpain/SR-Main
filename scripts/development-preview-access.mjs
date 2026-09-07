import { createHmac, timingSafeEqual } from 'node:crypto';

export function validPreviewClaim(value, now = Date.now()) {
  return value && typeof value.buildId === 'string' && typeof value.revision === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value.buildId) && /^[a-f0-9]{40}$/.test(value.revision)
    && Number.isInteger(value.port) && value.port >= 5281 && value.port <= 5288
    && Number.isFinite(value.expires) && value.expires > now && value.expires <= now + 8 * 3600000;
}
export function signPreviewAccess(secret, claim) {
  if (!secret || secret.length < 32 || !validPreviewClaim(claim)) throw new Error('Invalid preview access configuration');
  const body = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyPreviewAccess(secret, token, now = Date.now()) {
  if (!secret || secret.length < 32 || typeof token !== 'string' || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || parts.some(p => !/^[a-zA-Z0-9_-]+$/.test(p))) return null;
  const expected = createHmac('sha256', secret).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
  try { const claim = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); return validPreviewClaim(claim, now) ? claim : null; }
  catch { return null; }
}
export function previewAccessUrl(secret, domain, buildId, revision, port) {
  const token = signPreviewAccess(secret, { buildId, revision, port, expires: Date.now() + 8 * 3600000 });
  return `https://preview-${port}.${domain}/?__sr_grant=${token}`;
}
