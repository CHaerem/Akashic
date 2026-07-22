/**
 * CloudKit JS bootstrap.
 *
 * Lazily loads Apple's CloudKit JS from the CDN at runtime and exposes a small
 * auth + database facade for the data-layer adapters. Nothing here runs at
 * import time, so pulling this module in under the Supabase backend has no
 * effect (and never touches the network) until a function is actually called.
 *
 * Docs: https://developer.apple.com/documentation/cloudkitjs
 */

const CLOUDKIT_JS_URL = 'https://cdn.apple-cloudkit.com/ck/2/cloudkit.js';
const CONTAINER_ID = 'iCloud.no.akashic';
const SIGN_IN_BUTTON_ID = 'apple-sign-in-button';
const SIGN_OUT_BUTTON_ID = 'apple-sign-out-button';

type CKEnvironment = 'development' | 'production';

function readCloudKitEnv(): { environment: CKEnvironment; apiToken: string } {
    const environment: CKEnvironment =
        import.meta.env.VITE_CLOUDKIT_ENV === 'production' ? 'production' : 'development';
    const apiToken = import.meta.env.VITE_CLOUDKIT_API_TOKEN || '';
    return { environment, apiToken };
}

let cloudKitPromise: Promise<CloudKitJS.CloudKitStatic> | null = null;

/**
 * Load the CloudKit JS global, injecting the CDN <script> on first use.
 * Resolves immediately if `window.CloudKit` is already present (e.g. injected
 * by tests or a prior load). Memoized so the script is added at most once.
 */
export function loadCloudKit(): Promise<CloudKitJS.CloudKitStatic> {
    if (cloudKitPromise) return cloudKitPromise;

    cloudKitPromise = new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            reject(new Error('[cloudkit] CloudKit JS requires a browser environment'));
            return;
        }

        if (window.CloudKit) {
            resolve(window.CloudKit);
            return;
        }

        const finish = () => {
            if (window.CloudKit) {
                resolve(window.CloudKit);
            } else {
                reject(new Error('[cloudkit] CloudKit JS loaded but did not register a global'));
            }
        };
        const fail = () => reject(new Error('[cloudkit] Failed to load CloudKit JS from CDN'));

        const existing = document.querySelector<HTMLScriptElement>(
            `script[src="${CLOUDKIT_JS_URL}"]`
        );
        if (existing) {
            existing.addEventListener('load', finish);
            existing.addEventListener('error', fail);
            return;
        }

        const script = document.createElement('script');
        script.src = CLOUDKIT_JS_URL;
        script.async = true;
        script.addEventListener('load', finish);
        script.addEventListener('error', fail);
        document.head.appendChild(script);
    });

    return cloudKitPromise;
}

let container: CloudKitJS.Container | null = null;

/**
 * Get the configured default CloudKit container (configuring it once).
 */
export async function getContainer(): Promise<CloudKitJS.Container> {
    const CloudKit = await loadCloudKit();
    if (!container) {
        const { environment, apiToken } = readCloudKitEnv();
        CloudKit.configure({
            containers: [
                {
                    containerIdentifier: CONTAINER_ID,
                    apiTokenAuth: {
                        apiToken,
                        persist: true,
                        signInButton: { id: SIGN_IN_BUTTON_ID, theme: 'black' },
                        signOutButton: { id: SIGN_OUT_BUTTON_ID, theme: 'black' },
                    },
                    environment,
                },
            ],
        });
        container = CloudKit.getDefaultContainer();
    }
    return container;
}

/** The user's private database (owner's own zones). */
export async function getPrivateDatabase(): Promise<CloudKitJS.Database> {
    return (await getContainer()).privateCloudDatabase;
}

/** Databases holding zones shared with the signed-in user. */
export async function getSharedDatabase(): Promise<CloudKitJS.Database> {
    return (await getContainer()).sharedCloudDatabase;
}

/** The public database (mirror of published journeys). */
export async function getPublicDatabase(): Promise<CloudKitJS.Database> {
    return (await getContainer()).publicCloudDatabase;
}

// ---------------------------------------------------------------------------
// Auth facade (mirrors the supabase.auth surface the app relies on)
// ---------------------------------------------------------------------------

export interface CloudKitSession {
    /** The signed-in Apple ID identity, or null when signed out. */
    user: CloudKitJS.UserIdentity | null;
}

/**
 * Equivalent of `supabase.auth.getSession()`: returns the current CloudKit
 * identity (or null). Setting up auth is what surfaces the persisted session.
 */
export async function getCloudKitSession(): Promise<CloudKitSession> {
    const c = await getContainer();
    const user = await c.setUpAuth();
    return { user: user ?? null };
}

/**
 * Equivalent of `supabase.auth.onAuthStateChange()`: invokes `handler` whenever
 * the user signs in or out. Returns an unsubscribe function.
 */
export function onCloudKitAuthChange(handler: (session: CloudKitSession) => void): () => void {
    let active = true;

    getContainer()
        .then((c) => {
            const listenIn = () => {
                if (!active) return;
                c.whenUserSignsIn()
                    .then((user) => {
                        if (!active) return;
                        handler({ user });
                        listenIn();
                    })
                    .catch(() => {});
            };
            const listenOut = () => {
                if (!active) return;
                c.whenUserSignsOut()
                    .then(() => {
                        if (!active) return;
                        handler({ user: null });
                        listenOut();
                    })
                    .catch(() => {});
            };
            listenIn();
            listenOut();
        })
        .catch(() => {});

    return () => {
        active = false;
    };
}

/**
 * Mount CloudKit JS's own "Sign in with Apple" button inside `el`.
 *
 * CloudKit JS renders the button into an element carrying its canonical id, so
 * we tag the container (or a child) with it and kick off auth setup, which
 * triggers the render.
 */
export async function mountAppleSignInButton(el: HTMLElement): Promise<void> {
    if (!el.id) {
        el.id = SIGN_IN_BUTTON_ID;
    } else if (el.id !== SIGN_IN_BUTTON_ID) {
        // Host a dedicated child so we never clobber the caller's id.
        let target = el.querySelector<HTMLElement>(`#${SIGN_IN_BUTTON_ID}`);
        if (!target) {
            target = document.createElement('div');
            target.id = SIGN_IN_BUTTON_ID;
            el.appendChild(target);
        }
    }
    // setUpAuth() is what makes CloudKit JS render its sign-in/out buttons.
    await getContainer().then((c) => c.setUpAuth());
    // TODO(cloudkit): confirm button theming/sizing against the liquid-glass UI
    // and handle the signed-in -> sign-out button swap.
}
