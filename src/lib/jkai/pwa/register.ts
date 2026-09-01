import { offerAppUpdate } from './update-state.svelte';

interface RemoteVersion {
	sha?: string | null;
	short?: string | null;
}

// Registers the jkai service worker. Imported from the jkai layout onMount so
// the SW is only requested for users actually visiting /jkai.
export async function registerJkaiSW(currentSha: string | null): Promise<() => void> {
	if (typeof window === 'undefined') return () => {};
	if (!('serviceWorker' in navigator)) return () => {};
	const { registerSW } = await import('virtual:pwa-register');
	let registration: ServiceWorkerRegistration | undefined;
	let remoteVersion: RemoteVersion | null = null;
	let pollTimer: number | undefined;
	let workerTimer: number | undefined;

	const readRemoteVersion = async (): Promise<RemoteVersion | null> => {
		try {
			const response = await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' });
			if (!response.ok) return null;
			return (await response.json()) as RemoteVersion;
		} catch {
			return null;
		}
	};

	const checkForRelease = async (): Promise<void> => {
		remoteVersion = await readRemoteVersion();
		if (remoteVersion?.sha && currentSha && remoteVersion.sha !== currentSha) {
			await registration?.update();
		}
	};

	const updateSW = registerSW({
		immediate: true,
		onNeedRefresh() {
			offerAppUpdate(
				async () => {
					await updateSW(true);
				},
				remoteVersion?.short,
			);
		},
		onRegisteredSW(swUrl, reg) {
			// eslint-disable-next-line no-console
			console.debug('[jkai-pwa] SW registered at', swUrl, reg);
			if (!reg) return;
			registration = reg;

			// JKAI is often left open as an installed app for days. Registration
			// checks once at mount, but a long-lived client otherwise keeps running
			// the old hashed application chunks until it is manually reopened. Ask
			// for a lightweight update check while the app is open. The version probe
			// makes a newly deployed release visible within a minute; the five-minute
			// worker check remains the fallback if that endpoint is unavailable.
			void reg.update();
			void checkForRelease();
			pollTimer = window.setInterval(() => void checkForRelease(), 60 * 1000);
			workerTimer = window.setInterval(() => void reg.update(), 5 * 60 * 1000);
		},
		onRegisterError(err) {
			// eslint-disable-next-line no-console
			console.warn('[jkai-pwa] SW registration failed', err);
		},
	});

	const onVisible = () => {
		if (document.visibilityState === 'visible') void checkForRelease();
	};
	document.addEventListener('visibilitychange', onVisible);

	return () => {
		if (pollTimer !== undefined) window.clearInterval(pollTimer);
		if (workerTimer !== undefined) window.clearInterval(workerTimer);
		document.removeEventListener('visibilitychange', onVisible);
	};
}
