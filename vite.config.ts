import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		sveltekit(),
		VitePWA({
			strategies: 'injectManifest',
			srcDir: 'src',
			filename: 'sw.js',
			registerType: 'autoUpdate',
			manifest: false,
			injectManifest: {
				globIgnores: ['**/*.map'],
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
			},
			devOptions: {
				enabled: false,
			},
		}),
	],
});