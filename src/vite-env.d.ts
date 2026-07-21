/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_MAPBOX_TOKEN: string;
    readonly VITE_STAGING_BRANCH?: string;
    readonly VITE_DEPLOY_TIME?: string;
    /** Data backend selector: 'supabase' (default) | 'cloudkit' */
    readonly VITE_DATA_BACKEND?: string;
    /** CloudKit environment: 'development' (default) | 'production' */
    readonly VITE_CLOUDKIT_ENV?: string;
    /** CloudKit JS API token for the iCloud.no.akashic container */
    readonly VITE_CLOUDKIT_API_TOKEN?: string;
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
