import { env } from '$env/dynamic/private';
import crypto from 'crypto';

const SALT = 'strange-ramblings-admin';

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + SALT).digest('hex');
}

export function getExpectedHash(): string {
  return hashPassword(env.ADMIN_PASSWORD || '');
}

export function validateSession(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  return cookieValue === getExpectedHash();
}

export function createSessionCookie(password: string): string {
  return hashPassword(password);
}
