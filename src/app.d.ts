/// <reference types="vite-plugin-pwa/client" />
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Session } from '@auth/sveltekit';

declare global {
	/** Git tree baked into the client bundle by vite.config.ts. */
	const __JKAI_BUILD_ID__: string;

	namespace App {
		// interface Error {}
		interface Locals {
			auth(): Promise<Session | null>;
			davAuth?: {
				credentialId: string;
				ownerEmail: string;
				label: string;
			};
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module '*.glsl?raw' {
	const value: string;
	export default value;
}

// Types for virtual:pwa-register (and friends) come from the triple-slash
// reference to `vite-plugin-pwa/client` at the top of this file — no manual
// shim needed.

export {};
