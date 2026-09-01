// Registers the jkai service worker. Imported dynamically from the jkai layout
// onMount so the SW is only requested for users actually visiting /jkai.
export async function registerJkaiSW(): Promise<void> {
	if (typeof window === 'undefined') return;
	if (!('serviceWorker' in navigator)) return;
	const { registerSW } = await import('virtual:pwa-register');
	registerSW({
		immediate: true,
		onRegisteredSW(swUrl, reg) {
			// eslint-disable-next-line no-console
			console.debug('[jkai-pwa] SW registered at', swUrl, reg);
			if (!reg) return;

			// JKAI is often left open as an installed app for days. Registration
			// checks once at mount, but a long-lived client otherwise keeps running
			// the old hashed application chunks until it is manually reopened. Ask
			// for a lightweight update check while the app is open; autoUpdate owns
			// activation and reload once a different worker is found.
			void reg.update();
			window.setInterval(() => void reg.update(), 5 * 60 * 1000);
		},
		onRegisterError(err) {
			// eslint-disable-next-line no-console
			console.warn('[jkai-pwa] SW registration failed', err);
		},
	});
}
