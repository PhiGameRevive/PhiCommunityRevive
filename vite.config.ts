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
				// 应用壳（js/css/html）之外再预缓存少量小体积静态文件（favicon/manifest/图标/回退横幅），
				// 大体积游戏资源（贴图、字体、音效）由 sw.js 运行时 CacheFirst 接管，避免首装下载过重
				globPatterns: [
					'**/*.{js,css,html}',
					'favicon.ico',
					'manifest.webmanifest',
					'AppIcon.png',
					'AppIcon-512.png',
					'banner.png',
				],
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
			},
			devOptions: {
				enabled: false,
			},
		}),
	],
});