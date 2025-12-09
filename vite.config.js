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
					// Supabase API - cache journey data for offline access
					{
						urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\//,
						handler: "NetworkFirst",
						options: {
							cacheName: "supabase-api",
							expiration: {
								maxEntries: 50,
								maxAgeSeconds: 60 * 60 * 24, // 24 hours
							},
							networkTimeoutSeconds: 10,
							cacheableResponse: {
								statuses: [0, 200],
							},
						},
					},
					// R2 media - cache photos for offline viewing
					{
						urlPattern: /^https:\/\/akashic-media\..*\.workers\.dev\//,
						handler: "CacheFirst",
						options: {
							cacheName: "r2-media",
							expiration: {
								maxEntries: 200,
								maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
							},
							cacheableResponse: {
								statuses: [0, 200],
							},
						},
					},
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
					// Google Fonts
					{
						urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
						handler: "StaleWhileRevalidate",
						options: {
							cacheName: "google-fonts-stylesheets",
						},
					},
					{
						urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
						handler: "CacheFirst",
						options: {
							cacheName: "google-fonts-webfonts",
							expiration: {
								maxEntries: 30,
								maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
							},
						},
					},
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
					vendor: ["react", "react-dom", "react-router-dom"],
					motion: ["framer-motion"],
					radixui: ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tabs"],
				},
			},
		},
	},
});
