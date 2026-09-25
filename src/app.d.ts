// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Session } from '@auth/sveltekit';
import type { Viewer } from '$lib/server/viewer';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			auth(): Promise<Session | null>;
			/** Set by `viewerOf` — one owner/member/guest answer per request. */
			viewer?: Promise<Viewer>;
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

export {};
