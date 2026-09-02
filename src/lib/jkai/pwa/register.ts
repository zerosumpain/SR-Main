import { offerAppUpdate } from './update-state.svelte';

interface RemoteVersion {
	sha?: string | null;
	short?: string | null;
	tree?: string | null;
}

const JKAI_SCOPE_PATH = '/jkai';
const LEGACY_JKAI_SCOPE_PATH = '/jkai/';
const UPDATE_RELOAD_FALLBACK_MS = 3_000;

export function buildIdFrom(version: RemoteVersion | null): string | null {
	return version?.tree?.trim() || null;
}

export function shortBuildId(buildId: string | null): string {
	if (!buildId) return 'unknown';
	return buildId.length > 8 ? buildId.slice(0, 8) : buildId;
}

export function isDifferentBuild(version: RemoteVersion | null, currentBuildId: string): boolean {
	const remoteBuildId = buildIdFrom(version);
	return remoteBuildId !== null && remoteBuildId !== currentBuildId;
}

export function isLegacyJkaiScope(scope: string, origin: string): boolean {
	try {
		const url = new URL(scope, origin);
		return url.origin === origin && url.pathname === LEGACY_JKAI_SCOPE_PATH;
	} catch {
		return false;
	}
}

async function removeLegacyJkaiRegistration(): Promise<void> {
	if (typeof navigator.serviceWorker.getRegistrations !== 'function') return;
	try {
		const registrations = await navigator.serviceWorker.getRegistrations();
		await Promise.all(
			registrations
				.filter((registration) => isLegacyJkaiScope(registration.scope, window.location.origin))
				.map((registration) => registration.unregister()),
		);
	} catch (err) {
		// A failed migration must not prevent the new, correctly scoped worker
		// from registering. Leave a useful trace for browser-side diagnosis.
		console.warn('[jkai-pwa] legacy worker cleanup failed', err);
	}
}

async function applyWaitingUpdate(updateSW: (reloadPage?: boolean) => Promise<void>): Promise<void> {
	let timer: number | undefined;
	let onControllerChange: (() => void) | undefined;
	const controllerChanged = new Promise<void>((resolve) => {
		onControllerChange = () => resolve();
		navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
		timer = window.setTimeout(resolve, UPDATE_RELOAD_FALLBACK_MS);
	});

	try {
		await updateSW(true);
		// Workbox normally reloads on controllerchange. The timeout is deliberate:
		// a browser with a stale/out-of-scope registration must still make the
		// button do something observable and load the network's current app.
		await controllerChanged;
	} finally {
		if (timer !== undefined) window.clearTimeout(timer);
		if (onControllerChange) {
			navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
		}
	}
	window.location.reload();
}

// Registers the jkai service worker. Imported from the jkai layout onMount so
// the SW is only requested for users actually visiting /jkai.
export async function registerJkaiSW(currentBuildId: string): Promise<() => void> {
	if (typeof window === 'undefined') return () => {};
	if (!('serviceWorker' in navigator)) return () => {};
	await removeLegacyJkaiRegistration();
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
		if (isDifferentBuild(remoteVersion, currentBuildId)) {
			await registration?.update();
		}
	};

	const showWaitingUpdate = async (): Promise<void> => {
		// onNeedRefresh can fire during registration, before the first version
		// probe completes. Read it here so the label and comparison are never a
		// race against onRegisteredSW.
		remoteVersion = (await readRemoteVersion()) ?? remoteVersion;
		const nextBuildId = buildIdFrom(remoteVersion);
		if (nextBuildId === currentBuildId) return;
		offerAppUpdate(
			() => applyWaitingUpdate(updateSW),
			nextBuildId ? shortBuildId(nextBuildId) : null,
		);
	};

	const updateSW = registerSW({
		immediate: true,
		onNeedRefresh() {
			void showWaitingUpdate();
		},
		onRegisteredSW(swUrl, reg) {
			// eslint-disable-next-line no-console
			console.debug('[jkai-pwa] SW registered at', swUrl, reg, 'scope', JKAI_SCOPE_PATH);
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
