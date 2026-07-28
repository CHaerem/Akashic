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
				// Raised for large photos. MEASURED after MAP-05 deleted mapbox-gl (which was the
				// original reason, at 1626 KB): the largest precached asset is now
				// dist/assets/index-*.js at ~244 KB, so 20 MB is far above what the build needs and
				// is doing nothing for the JS. It is kept for the PHOTO half of that original
				// sentence — fixture and showcase imagery are precached by `globPatterns`, and a
				// single HEIC off a modern iPhone clears Workbox's 2 MB default on its own.
				maximumFileSizeToCacheInBytes: 20 * 1024 * 1024, // 20MB
				// Offline fallback
				navigateFallback: "/index.html",
				navigateFallbackDenylist: [/^\/api/, /^\/share-target/],
				runtimeCaching: [
					// LEG-12: the R2-media rule that used to lead this list is gone with the Cloudflare
					// Worker it cached (`akashic-media.*.workers.dev`, deleted in LEG-01). It had become
					// dead config — the pattern can no longer match anything, and a `CacheFirst` rule
					// against a dead origin only serves stale entries until they expire.
					// MAP-05: the five `api.mapbox.com` rules that stood here (styles, v4 tiles, raster v1
					// terrain, fonts and sprites) are gone with the vendor. Same reasoning as the two notes
					// around them: a runtime-caching rule for an origin the app can no longer contact is dead
					// config that only keeps a stale cache alive.
					//
					// There is deliberately NO MapKit replacement, and it is not an oversight. MapKit JS is
					// loaded as a `<script>` from `cdn.apple-mapkit.com` by `src/lib/map/mapkit/loader.ts` and
					// fetches its own tiles internally; Apple sets the caching policy on both, and a
					// StaleWhileRevalidate rule over a signed, token-scoped CDN would cache responses whose
					// authorisation outlives them. The journey map is therefore ONLINE-ONLY — the app shell and
					// the landing globe still work offline (the globe draws from precached coastline geometry
					// and needs no network at all, which is MAP-02's whole point), but a journey opened with no
					// connection shows `MapErrorFallback` where the map would be.
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
		// `.claude/**` is load-bearing, not tidiness (QUA-49's gate run found it): parallel agent
		// worktrees live under `.claude/worktrees/` INSIDE this checkout, each carrying a full copy
		// of `src/`. Without the exclusion, vitest run from the repo root scans every copy — the
		// measured run was 300 files / 3852 tests against a 53 / 680 baseline — and another tree's
		// state fails YOUR gate. The count you trust is only real from a checkout this glob is
		// scoped to.
		exclude: ["**/node_modules/**", "**/e2e/**", "**/.claude/**"],
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
	// MAP-05 has since deleted MapboxGlobe.tsx, so every measurement below names a file that no
	// longer exists. They are kept because they are the EVIDENCE for this setting, not a
	// description of current state, and the setting protects whatever gets written next — which
	// was the argument for it in the first place. Re-measuring the "before" would require
	// reverting the setting; do not treat the stale filenames as a reason to drop it.
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
					// MAP-05 removed `mapbox: ["mapbox-gl"]` here. It was 1 664 113 bytes raw /
					// 458.75 KiB gzip of a 8668 KB dist — the single largest asset in the build.
					vendor: ["react", "react-dom"],
					motion: ["framer-motion"],
					radixui: ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tabs"],
				},
			},
		},
	},
});
