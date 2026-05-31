/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
	({ url }) => url.pathname.startsWith('/api/jkai/conversations'),
	new StaleWhileRevalidate({
		cacheName: 'jkai-conversations-api',
		plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 })],
	}),
);

registerRoute(
	({ url }) => url.pathname.startsWith('/api/jkai/builds'),
	new StaleWhileRevalidate({
		cacheName: 'jkai-builds-api',
		plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 })],
	}),
);

registerRoute(({ request }) => request.method !== 'GET', new NetworkOnly());

// jkai navigations: network-first with a 30-day cache.
registerRoute(
	({ request, url }) =>
		request.mode === 'navigate' && url.pathname.startsWith('/jkai'),
	new NetworkFirst({
		cacheName: 'jkai-navigation',
		networkTimeoutSeconds: 5,
		plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 })],
	}),
);

self.addEventListener('push', (event) => {
	const data: { title?: string; body?: string; url?: string } = (() => {
		try { return event.data?.json() ?? {}; } catch { return {}; }
	})();
	const title = data.title ?? 'jkai';
	const options: NotificationOptions = {
		body: data.body ?? '',
		data: { url: data.url ?? '/jkai' },
		icon: '/jkai-pwa/icon-192.png',
		badge: '/jkai-pwa/icon-192.png',
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data as { url?: string })?.url ?? '/jkai';
	event.waitUntil((async () => {
		const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
		for (const client of all) {
			if (client.url.includes('/jkai') && 'focus' in client) {
				await client.focus();
				if ('navigate' in client) await (client as WindowClient).navigate(url);
				return;
			}
		}
		await self.clients.openWindow(url);
	})());
});
