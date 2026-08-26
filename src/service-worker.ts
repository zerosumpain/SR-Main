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

// jkai navigations: network-first, with a cached shell for going offline.
//
// The age here is load-bearing and used to be 30 days, which is far longer than
// it can safely be. A cached HTML shell names HASHED chunk files; a later deploy
// publishes new hashes and `cleanupOutdatedCaches` removes the old ones. A shell
// that outlives its chunks is a page that loads and then silently runs the wrong
// code — which is exactly what happened on 2026-08-26: after three deploys in an
// hour, /jkai/daydreams rendered the naming form from a build that predated the
// map, so the map "was not rendering" when in fact it was not in the bundle the
// browser had.
//
// One day keeps the offline shell useful (that is the point of caching a
// navigation at all) while bounding how long a stale one can mislead. Network
// still wins whenever it answers inside the timeout.
registerRoute(
	({ request, url }) =>
		request.mode === 'navigate' && url.pathname.startsWith('/jkai'),
	new NetworkFirst({
		cacheName: 'jkai-navigation',
		networkTimeoutSeconds: 5,
		plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 })],
	}),
);

// Broads Pilot (/projects/broads-pilot): cache the small static datasets so the
// planner + routing work offline, the page navigations network-first, and map
// tiles network-first (online-first, but last-viewed tiles survive offline).
registerRoute(
	({ url }) => url.pathname.startsWith('/broads-pilot/') && url.pathname.endsWith('.json'),
	new StaleWhileRevalidate({
		cacheName: 'broads-pilot-data',
		plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 })],
	}),
);
registerRoute(
	({ request, url }) => request.mode === 'navigate' && url.pathname.startsWith('/projects/broads-pilot'),
	new NetworkFirst({
		cacheName: 'broads-pilot-nav',
		networkTimeoutSeconds: 5,
		plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 })],
	}),
);
registerRoute(
	({ url }) => /(?:tile\.openstreetmap\.org|tiles\.openseamap\.org)/.test(url.hostname),
	new NetworkFirst({
		cacheName: 'broads-pilot-tiles',
		networkTimeoutSeconds: 4,
		plugins: [new ExpirationPlugin({ maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 14 })],
	}),
);

self.addEventListener('push', (event) => {
	const data: {
		title?: string;
		body?: string;
		url?: string;
		/** Buttons on the notification itself. Generic transport: the sender
		 *  supplies the labels, and `actionEndpoint` says where a tap goes. */
		actions?: Array<{ action: string; title: string }>;
		/** POSTed to with `{ ...actionPayload, action }` when a button is tapped. */
		actionEndpoint?: string;
		actionPayload?: Record<string, unknown>;
	} = (() => {
		try { return event.data?.json() ?? {}; } catch { return {}; }
	})();
	const title = data.title ?? 'jkai';
	const options: NotificationOptions = {
		body: data.body ?? '',
		data: {
			url: data.url ?? '/jkai',
			actionEndpoint: data.actionEndpoint ?? null,
			actionPayload: data.actionPayload ?? null,
		},
		icon: '/jkai-pwa/icon-192.png',
		badge: '/jkai-pwa/icon-192.png',
		// The platform caps how many it will render (two on most). Sending more
		// is not an error, they are simply dropped, so order matters.
		actions: Array.isArray(data.actions) ? data.actions.slice(0, 3) : undefined,
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const nd = (event.notification.data ?? {}) as {
		url?: string;
		actionEndpoint?: string | null;
		actionPayload?: Record<string, unknown> | null;
	};
	const url = nd.url ?? '/jkai';

	// A button tap answers in place and opens nothing. That is the whole point
	// of it — a reply that costs a page load is not a one-tap reply, and for a
	// mute in particular the tap has to be final and immediate.
	if (event.action && nd.actionEndpoint) {
		event.waitUntil(
			fetch(nd.actionEndpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ ...(nd.actionPayload ?? {}), verdict: event.action }),
			}).catch(() => {
				// Offline or signed out. Swallowed deliberately: re-raising here
				// would show the user a service-worker error for a tap that will
				// simply have to be repeated on the page.
			}),
		);
		return;
	}

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
