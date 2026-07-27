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
