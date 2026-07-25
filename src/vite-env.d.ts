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
    /** 'true' skips the Apple ID sign-in gate so e2e can drive the app */
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
