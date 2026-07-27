import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		VitePWA({
			registerType: "autoUpdate",
			includeAssets: ["favicon.ico", "robots.txt", "apple-touch-icon.png", "offline.html"],
			// Import custom share target handler
			injectRegister: "auto",
			manifest: {
				name: "Akashic - Trek Explorer",
				short_name: "Akashic",
				description: "Explore mountain treks around the world in 3D",
				theme_color: "#0a0a0f",
				background_color: "#0a0a0f",
				display: "standalone",
				orientation: "portrait",
				icons: [
					{
						src: "pwa-192x192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
					},
					{
						src: "pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "any maskable",
					},
				],
				share_target: {
					action: "/share-target",
					method: "POST",
					enctype: "multipart/form-data",
					params: {
						files: [
							{
								name: "photos",
								accept: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"],
							},
						],
					},
				},
			},
			workbox: {
				// Import custom share target handler
				importScripts: ["sw-share-target.js"],
				// Pre-cache app shell and trek data
				globPatterns: ["**/*.{js,css,html,ico,png,svg,json,woff,woff2}"],
				// Increase max file size for Mapbox GL JS and large photos
				maximumFileSizeToCacheInBytes: 20 * 1024 * 1024, // 20MB
				// Offline fallback
				navigateFallback: "/index.html",
				navigateFallbackDenylist: [/^\/api/, /^\/share-target/],
				runtimeCaching: [
					// LEG-12: the R2-media rule that used to lead this list is gone with the Cloudflare
					// Worker it cached (`akashic-media.*.workers.dev`, deleted in LEG-01). It had become
					// dead config — the pattern can no longer match anything, and a `CacheFirst` rule
					// against a dead origin only serves stale entries until they expire.
					// Mapbox Style API
					{
						urlPattern: /^https:\/\/api\.mapbox\.com\/styles\//,
						handler: "StaleWhileRevalidate",
						options: {
							cacheName: "mapbox-styles",
							expiration: {
								maxEntries: 50,
								maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
							},
						},
					},
					// Mapbox Tiles (raster and vector)
					{
						urlPattern: /^https:\/\/api\.mapbox\.com\/v4\//,
						handler: "CacheFirst",
						options: {
							cacheName: "mapbox-tiles",
							expiration: {
								maxEntries: 1000,
								maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
							},
							cacheableResponse: {
								statuses: [0, 200],
							},
						},
					},
					// Mapbox Terrain and Satellite tiles
					{
						urlPattern: /^https:\/\/api\.mapbox\.com\/raster\/v1\//,
						handler: "CacheFirst",
						options: {
							cacheName: "mapbox-terrain",
							expiration: {
								maxEntries: 500,
								maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
							},
							cacheableResponse: {
								statuses: [0, 200],
							},
						},
					},
					// Mapbox Fonts
					{
						urlPattern: /^https:\/\/api\.mapbox\.com\/fonts\//,
						handler: "CacheFirst",
						options: {
							cacheName: "mapbox-fonts",
							expiration: {
								maxEntries: 50,
								maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
							},
						},
					},
					// Mapbox Sprite images
					{
						urlPattern: /^https:\/\/api\.mapbox\.com\/.*sprite/,
						handler: "CacheFirst",
						options: {
							cacheName: "mapbox-sprites",
							expiration: {
								maxEntries: 20,
								maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
							},
						},
					},
					// LEG-17: the two Google Fonts rules that stood here are gone with the origin. Roboto is
					// self-hosted now, so it is precached by `globPatterns` above (which already lists woff2)
					// along with the rest of the build. A runtime rule for a domain we no longer contact would
					// only have kept a dead cache alive.
				],
			},
		}),
	],
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: "./vitest.setup.js",
		exclude: ["**/node_modules/**", "**/e2e/**"],
		// Timeout settings for more robust tests
		testTimeout: 10000,
		hookTimeout: 10000,
		// Fail fast on first error in CI
		bail: process.env.CI ? 1 : 0,
		// Better error reporting
		reporters: process.env.CI ? ["default", "github-actions"] : ["default"],
	},
	// QUA-44: debug console output must not be able to reach production, as a BUILD
	// PROPERTY rather than as a habit. On 2026-07-27 the live site printed sixteen lines of
	// "[MapboxGlobe camera effect] …" before the globe settled, from four console.log calls
	// nobody meant to ship. Deleting those four lines fixes that day only; the fifth one
	// somebody adds while debugging would ship exactly the same way.
	//
	// `pure`, not `drop: ["console"]`, and the difference matters: console.warn and
	// console.error carry the diagnostics this project actually debugs from — the CloudKit
	// adapter's error path is how QUA-40 was found at all. There are 58 console.warn/error
	// calls in src/ (measured), and every one of them survives this setting.
	//
	// MEASURED in this tree, because "the bundler removes it" is the class of build-tool
	// belief this repo has been burned by before (INFOPLIST_KEY_* was declared correctly and
	// silently dropped from every shipped plist):
	//   before — dist/assets/AkashicApp-*.js held 4 console.log, all four the MapboxGlobe ones
	//   after  — 0 console.log anywhere under dist/, 18 console.error and 6 console.warn intact
	//            in that same chunk (mapbox-gl's own 13 debug logs go too — `pure` reaches the
	//            bundled output, not only our TS)
	//
	// HOW it strips, measured rather than assumed, because I wrote the wrong explanation first:
	// esbuild's transform does not delete the call, it ANNOTATES it. Dev serves
	// `/* @__PURE__ */ console.log("…")` verbatim (measured on a `vite` dev server:
	// GET /src/components/MapboxGlobe.tsx, line 177), so `npm run dev` still logs normally and
	// debugging is unaffected. Rollup's tree-shaking is what drops the annotated call — NOT the
	// minifier: a `vite build --minify false` also emits it nowhere. So the thing that would
	// break this is losing `pure` here or disabling treeshake, not a change to `build.minify`.
	//
	// The trap that nearly produced the opposite conclusion: grepping the served
	// assets/index-*.js for "console.log" returns ZERO both before and after, because the
	// calls were in a different chunk. Grep every file under dist/, never one chunk.
	// scripts/assertNoFixtureInBundle.mjs asserts this over the whole tree, in CI.
	esbuild: {
		pure: ["console.log", "console.debug", "console.info", "console.trace", "console.dir", "console.table"],
		drop: ["debugger"],
	},
	base: "/",
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks: {
					mapbox: ["mapbox-gl"],
					vendor: ["react", "react-dom"],
					motion: ["framer-motion"],
					radixui: ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tabs"],
				},
			},
		},
	},
});
