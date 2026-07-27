import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Bootstrap tests drive a wholesale global `window.CloudKit` fixture — no CDN
 * script is ever injected (loadCloudKit resolves immediately when the global
 * is already present) and nothing hits the network.
 *
 * QUA-40 note: this first block runs with `VITE_E2E_TEST_MODE` unset, so it doubles as
 * the inverse-direction guard on the new E2E seam in `getContainer()` — with the flag off
 * the real bootstrap must still configure Apple's container. An agent who inverts or
 * widens that guard gets a red test here rather than a production bundle that quietly
 * serves fabricated journeys. The second block below covers the flag-on direction, and
 * `scripts/assertNoFixtureInBundle.mjs` covers the built artifact; all three catch
 * different mistakes.
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

    it('clears the memo when the CDN load fails, so a later call retries', async () => {
        // No global yet: loadCloudKit injects a <script> and waits for load/error.
        delete (window as Window).CloudKit;
        const ck = await loadFresh();

        // First attempt: force the injected script to error (a transient CDN failure).
        const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation(((
            node: Node
        ) => {
            queueMicrotask(() => (node as HTMLScriptElement).dispatchEvent(new Event('error')));
            return node;
        }) as typeof document.head.appendChild);

        await expect(ck.loadCloudKit()).rejects.toThrow(/Failed to load CloudKit JS/);
        appendSpy.mockRestore();

        // Connectivity restored: the global is present now. Because the rejected promise
        // was NOT left memoized, the retry resolves instead of replaying the failure.
        installFixture({ userRecordName: 'u' });
        await expect(ck.loadCloudKit()).resolves.toBe((window as Window).CloudKit);
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

/**
 * The E2E fixture seam (QUA-40).
 *
 * MEASURED against the CloudKit REST endpoint with the production token:
 *   Origin: https://akashic.no -> 200; Origin: http://localhost:5173 -> 401; no Origin -> 401.
 * The production token is origin-locked to the apex, so a CI runner serving the app from
 * localhost 401s on every call and the gate could only ever be red. Under
 * `VITE_E2E_TEST_MODE=true`, `getContainer()` returns a local fixture instead and Apple is
 * never contacted — not the REST endpoint and not the CDN.
 */
describe('cloudkit bootstrap under VITE_E2E_TEST_MODE', () => {
    afterEach(() => {
        delete (window as Window).CloudKit;
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    async function loadInE2EMode() {
        vi.stubEnv('VITE_E2E_TEST_MODE', 'true');
        vi.resetModules();
        return import('./cloudkit');
    }

    it('returns the fixture container without configuring CloudKit JS', async () => {
        // Present but must go unused: the guard returns before loadCloudKit().
        const fixture = installFixture({ userRecordName: 'would-be-signed-in' });
        const ck = await loadInE2EMode();

        const container = await ck.getContainer();

        expect(fixture.configure).not.toHaveBeenCalled();
        expect(fixture.getDefaultContainer).not.toHaveBeenCalled();
        expect(container).not.toBe(fixture.container);
        // Memoized like the real one.
        expect(await ck.getContainer()).toBe(container);
    });

    it('resolves a null session, which is what keeps the data layer on the public path', async () => {
        const ck = await loadInE2EMode();
        // isSignedIn() reads this; false is what routes journeyAdapter/photoAdapter to the
        // public adapters, matching the chimera AuthGuard already creates (it forces
        // signedIn=true at the UI layer while the data layer reads public). It is also what
        // makes canUserComment return false WITHOUT logging — that call has no signed-out
        // guard and is mounted for every selected day.
        await expect(ck.getCloudKitSession()).resolves.toEqual({ user: null });
    });

    it('serves the two fixture journeys, most recent first is left to the adapter', async () => {
        const ck = await loadInE2EMode();
        const response = await (await ck.getContainer()).publicCloudDatabase.performQuery({
            recordType: 'PublicJourney',
        });

        expect(response.records).toHaveLength(2);
        // Query order is deliberately NOT sort order, so the adapter's deterministic sort
        // has real work to do.
        expect(response.records.map((r) => r.recordName)).toEqual([
            'e2e-coastal-ridge',
            'e2e-alpine-loop',
        ]);
        // Deliberately not the owner's real slugs: a fixture wearing a live slug teaches the
        // next reader that the gate exercises real published data. See publicShowcase.ts.
    });

    it('honours the journeySlug predicate rather than ignoring filterBy', async () => {
        const ck = await loadInE2EMode();
        const db = (await ck.getContainer()).publicCloudDatabase;
        const slugFilter = (slug: string) => ({
            recordType: 'PublicPhoto',
            filterBy: [
                { fieldName: 'journeySlug', comparator: 'EQUALS', fieldValue: { value: slug } },
            ],
        });

        expect((await db.performQuery(slugFilter('e2e-alpine-loop'))).records).toHaveLength(3);
        // A journey with no photos must return none, not everything. A fixture DB that
        // ignored filterBy would bleed one journey's photos into another's grid, and the
        // adapter's predicate could be wrong without any test noticing.
        expect((await db.performQuery(slugFilter('e2e-coastal-ridge'))).records).toHaveLength(0);
    });

    it('paginates: resultsLimit is honoured and the continuation marker advances', async () => {
        const ck = await loadInE2EMode();
        const db = (await ck.getContainer()).publicCloudDatabase;

        const first = await db.performQuery({ recordType: 'PublicPhoto' }, { resultsLimit: 2 });
        expect(first.records).toHaveLength(2);
        expect(first.continuationMarker).toBeDefined();

        const second = await db.performQuery(
            { recordType: 'PublicPhoto' },
            { resultsLimit: 2, continuationMarker: first.continuationMarker }
        );
        expect(second.records).toHaveLength(1);
        // Exhausted: no marker, so performQueryAll's loop terminates.
        expect(second.continuationMarker).toBeUndefined();
    });

    it('private and shared databases are empty rather than throwing', async () => {
        const ck = await loadInE2EMode();
        // A stray signed-in-path call has to stay quiet: anything that console.errors fails
        // day-navigation.spec.ts's zero-console-error test.
        await expect(
            (await ck.getPrivateDatabase()).performQuery({ recordType: 'Journey' })
        ).resolves.toEqual({ records: [] });
        await expect(
            (await ck.getSharedDatabase()).performQuery({ recordType: 'Journey' })
        ).resolves.toEqual({ records: [] });
    });

    it('never settles the auth listeners, so AuthGuard cannot loop', async () => {
        const ck = await loadInE2EMode();
        const seen: unknown[] = [];
        const unsubscribe = ck.onCloudKitAuthChange((s) => seen.push(s));

        await Promise.resolve();
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 5));

        // whenUserSignsOut resolving immediately would be an unbounded promise loop
        // (AuthGuard's listenOut re-subscribes inside its own .then); whenUserSignsIn
        // resolving with a user would flip signedInRef and hit window.location.reload() —
        // a reload loop that times out every spec with no visible cause.
        expect(seen).toEqual([]);
        expect(() => unsubscribe()).not.toThrow();
    });
});
