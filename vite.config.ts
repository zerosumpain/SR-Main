import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		allowedHosts: ['homeserv.tail668b8c.ts.net', 'homeserv'],
	},
	test: {
		include: ['tests/**/*.test.ts'],
		alias: {
			'$lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
		},
	},
});
