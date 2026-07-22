import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Bootstrap tests drive a wholesale global `window.CloudKit` fixture — no CDN
 * script is ever injected (loadCloudKit resolves immediately when the global
 * is already present) and nothing hits the network.
 */

interface Fixture {
    configure: ReturnType<typeof vi.fn>;
    getDefaultContainer: ReturnType<typeof vi.fn>;
    container: {
        publicCloudDatabase: object;
        privateCloudDatabase: object;
        sharedCloudDatabase: object;
        setUpAuth: ReturnType<typeof vi.fn>;
        whenUserSignsIn: ReturnType<typeof vi.fn>;
        whenUserSignsOut: ReturnType<typeof vi.fn>;
    };
}

function installFixture(user: CloudKitJS.UserIdentity | null): Fixture {
    const container = {
        publicCloudDatabase: {},
        privateCloudDatabase: {},
        sharedCloudDatabase: {},
        setUpAuth: vi.fn(async () => user),
        // Never resolve — we only assert registration, not delivery.
        whenUserSignsIn: vi.fn(() => new Promise<CloudKitJS.UserIdentity>(() => {})),
        whenUserSignsOut: vi.fn(() => new Promise<void>(() => {})),
    };
    const fixture: Fixture = {
        configure: vi.fn(() => fixture as unknown as CloudKitJS.CloudKitStatic),
        getDefaultContainer: vi.fn(() => container),
        container,
    };
    (window as Window).CloudKit = fixture as unknown as CloudKitJS.CloudKitStatic;
    return fixture;
}

async function loadFresh() {
    vi.resetModules();
    return import('./cloudkit');
}

describe('cloudkit bootstrap (global fixture)', () => {
    afterEach(() => {
        delete (window as Window).CloudKit;
        vi.resetModules();
    });

    it('configures the default container with the akashic container id', async () => {
        const fixture = installFixture({ userRecordName: 'user-1' });
        const ck = await loadFresh();

        const container = await ck.getContainer();

        expect(fixture.configure).toHaveBeenCalledTimes(1);
        const config = fixture.configure.mock.calls[0][0] as CloudKitJS.Config;
        expect(config.containers[0].containerIdentifier).toBe('iCloud.no.akashic');
        expect(config.containers[0].environment).toBe('development');
        expect(container).toBe(fixture.container);
    });

    it('getCloudKitSession returns the signed-in identity', async () => {
        const fixture = installFixture({ userRecordName: 'user-42', lookupInfo: { emailAddress: 'a@b.c' } });
        const ck = await loadFresh();

        const session = await ck.getCloudKitSession();

        expect(fixture.container.setUpAuth).toHaveBeenCalled();
        expect(session.user?.userRecordName).toBe('user-42');
    });

    it('getCloudKitSession returns null user when signed out', async () => {
        installFixture(null);
        const ck = await loadFresh();

        const session = await ck.getCloudKitSession();
        expect(session.user).toBeNull();
    });

    it('mountAppleSignInButton tags the element and triggers auth setup', async () => {
        const fixture = installFixture({ userRecordName: 'user-1' });
        const ck = await loadFresh();

        const el = document.createElement('div');
        await ck.mountAppleSignInButton(el);

        expect(el.id).toBe('apple-sign-in-button');
        expect(fixture.container.setUpAuth).toHaveBeenCalled();
    });

    it('onCloudKitAuthChange registers listeners and returns an unsubscribe fn', async () => {
        const fixture = installFixture({ userRecordName: 'user-1' });
        const ck = await loadFresh();

        const unsubscribe = ck.onCloudKitAuthChange(() => {});
        expect(typeof unsubscribe).toBe('function');

        // Let the container promise resolve so listeners get registered.
        await Promise.resolve();
        await Promise.resolve();
        expect(fixture.container.whenUserSignsIn).toHaveBeenCalled();
        expect(fixture.container.whenUserSignsOut).toHaveBeenCalled();

        expect(() => unsubscribe()).not.toThrow();
    });
});
