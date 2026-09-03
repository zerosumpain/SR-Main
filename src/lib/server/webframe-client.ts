import { createHmac } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export function webframeConfig(): { url: string; token: string } {
  const url = env.WEBFRAME_SERVICE_URL?.replace(/\/+$/, '');
  const token = env.WEBFRAME_SERVICE_TOKEN;
  if (!url || !token) throw error(503, 'webframe service is not securely configured');
  return { url, token };
}

export function webframeHeaders(token: string, json = false): Headers {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (json) headers.set('Content-Type', 'application/json');
  return headers;
}

/** Do not expose caller-chosen node ids as sidecar session capabilities. */
export function webframeSessionId(clientId: string, token: string): string {
  return createHmac('sha256', token).update(clientId, 'utf8').digest('hex');
}
