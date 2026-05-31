import { isStandalone } from './displayMode';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export interface PushClientOpts {
  vapidPublicKey: string;
}

export function canRequestPush(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (Notification.permission !== 'default') return false;
  return isStandalone();
}

export async function subscribeToPush(opts: PushClientOpts): Promise<PushSubscription> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('permission denied');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(opts.vapidPublicKey).buffer as ArrayBuffer,
  });
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) throw new Error(`subscribe HTTP ${res.status}`);
  return sub;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}
