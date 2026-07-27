/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_MAPBOX_TOKEN: string;
    readonly VITE_STAGING_BRANCH?: string;
    readonly VITE_DEPLOY_TIME?: string;
    /** CloudKit environment: 'development' (default) | 'production' */
    readonly VITE_CLOUDKIT_ENV?: string;
    /** CloudKit JS API token for the iCloud.no.akashic container */
    readonly VITE_CLOUDKIT_API_TOKEN?: string;
    /** Legacy media Worker origin, for relative object paths predating CloudKit assets */
    readonly VITE_MEDIA_URL?: string;
    /**
     * 'true' puts the app in E2E fixture mode. This controls DATA, not only UI (QUA-40):
     * as well as skipping the Apple ID sign-in gate and exposing `window.testHelpers`, it
     * makes `getContainer()` return a local fixture CloudKit container, so the app serves
     * the journeys in `src/fixtures/` and never contacts Apple. NEVER set it for a
     * production build — `deploy-pages.yml` refuses to deploy if it is set, and
     * `scripts/assertNoFixtureInBundle.mjs` fails the build if the fixture reaches `dist/`.
     */
    readonly VITE_E2E_TEST_MODE?: string;
    /**
     * Which map vendor draws the surfaces (MAP-03). `'mapkit'` puts the JOURNEY view on Apple MapKit JS;
     * anything else — including unset, the default — leaves both views on Mapbox. The globe stays on Mapbox
     * either way, because MapKit JS has no globe at all. See `src/components/MapSurface.tsx`.
     *
     * Do not default this to `mapkit` without also correcting `e2e/fixtures/test.ts`'s pinned host list, the
     * `api.mapbox.com` Workbox rules in `vite.config.js`, and `public/privacy.html` — which names Mapbox as
     * the map provider and as third-party telemetry, and is a user-facing statement rather than config.
     */
    readonly VITE_MAP_VENDOR?: string;
    /**
     * MapKit JS token, minted from the `.p8` rather than pasted from the portal — see
     * `scripts/mapkit/mintToken.mjs` for why, and `scripts/mapkit/devToken.mjs` for the one-line dev loop.
     * Public by design: it ships in the client bundle and is protected by its `origin` claim.
     */
    readonly VITE_MAPKIT_TOKEN?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module 'virtual:pwa-register' {
    export function registerSW(options?: {
        immediate?: boolean;
        onNeedRefresh?: () => void;
        onOfflineReady?: () => void;
        onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
        onRegisterError?: (error: unknown) => void;
    }): (reloadPage?: boolean) => Promise<void>;
}
