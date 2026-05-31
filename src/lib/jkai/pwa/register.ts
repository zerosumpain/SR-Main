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
		},
		onRegisterError(err) {
			// eslint-disable-next-line no-console
			console.warn('[jkai-pwa] SW registration failed', err);
		},
	});
}
