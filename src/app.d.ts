// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Session } from '@auth/sveltekit';
import type { Viewer } from '$lib/server/viewer';
import type { ViewingAs } from '$lib/server/view-as';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
            /** Only authenticated server entry points may set these exact service areas. */
            serviceAreas?: readonly string[];
			auth(): Promise<Session | null>;
			/** Set by `viewerOf` — one owner/member/guest answer per request. */
			viewer?: Promise<Viewer>;
			/** Set when the owner is viewing the site as someone else ($lib/server/view-as). */
			viewingAs?: ViewingAs;
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
