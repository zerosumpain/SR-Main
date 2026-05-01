import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		allowedHosts: ['homeserv.tail668b8c.ts.net', 'homeserv'],
		watch: {
			ignored: ['**/.claude/worktrees/**', '**/.svelte-kit/**', '**/node_modules/**'],
		},
	},
	test: {
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
		alias: {
			'$lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
		},
	},
});
