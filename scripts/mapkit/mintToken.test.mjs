import { describe, it, expect } from 'vitest';
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import {
    mintMapKitToken,
    decodePayload,
    daysUntilExpiry,
    DEFAULT_DAYS,
    DEFAULT_SCOPE,
    SCOPES,
} from './mintToken.mjs';

/**
 * MAP-04A — the token minter, tested without needing Apple's key.
 *
 * A generated P-256 key is cryptographically the same shape as an `AuthKey_*.p8`, so everything except
 * "does Apple accept it" is provable here. That last question needs the real key and is called out in
 * MAP-04; nothing in this file pretends to answer it.
 *
 * The claim assertions below are pinned to Apple's own DocC source, re-fetched 2026-07-27. That matters
 * because the first version of this suite asserted the OPPOSITE of Apple's spec on the `origin` claim and
 * passed — a suite can only be as right as the spec it was written from.
 */

const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const BASE = {
    keyId: 'ABC1234567',
    teamId: '9LVCB72DT8',
    privateKey,
    origin: 'akashic.no',
    now: 1_770_000_000_000,
};

function parts(token) {
    const [h, p, s] = token.split('.');
    return {
        header: JSON.parse(Buffer.from(h, 'base64url').toString()),
        payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
        signature: Buffer.from(s, 'base64url'),
        signingInput: `${h}.${p}`,
    };
}

describe('mintMapKitToken', () => {
    it('produces the header Apple requires', () => {
        const { header } = parts(mintMapKitToken(BASE).token);
        expect(header).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'ABC1234567' });
    });

    it('puts the team in iss and honours the requested lifetime', () => {
        const { payload } = parts(mintMapKitToken({ ...BASE, days: 30 }).token);
        expect(payload.iss).toBe('9LVCB72DT8');
        expect(payload.iat).toBe(1_770_000_000);
        expect(payload.exp - payload.iat).toBe(30 * 24 * 60 * 60);
    });

    it('defaults to a lifetime deliberately short of a year', () => {
        const { payload } = parts(mintMapKitToken(BASE).token);
        expect((payload.exp - payload.iat) / 86400).toBe(DEFAULT_DAYS);
        expect(DEFAULT_DAYS).toBeLessThan(365);
    });

    /**
     * **The assertion that matters most.** Node's default ES256 output is DER-encoded, which every JWT
     * verifier rejects — producing a token that looks perfect and always fails auth with no clue why. A
     * P-256 JWS signature is exactly 64 raw bytes (r‖s); DER is variable-length and ~70. So this test
     * fails the moment someone drops `dsaEncoding: 'ieee-p1363'`.
     */
    it('signs with raw r‖s, not DER — the mistake that yields a silently invalid token', () => {
        const { signature } = parts(mintMapKitToken(BASE).token);
        expect(signature.length).toBe(64);
        expect(signature[0]).not.toBe(0x30);   // 0x30 is the DER SEQUENCE tag
    });

    it('the signature actually verifies against the key', () => {
        const { signature, signingInput } = parts(mintMapKitToken(BASE).token);
        const ok = createVerify('sha256')
            .update(signingInput)
            .verify({ key: createPublicKey(publicKey), dsaEncoding: 'ieee-p1363' }, signature);
        expect(ok).toBe(true);
    });

    // MARK: - the scope claim

    /**
     * Apple: "A space-separated list of one or more Apple Maps frameworks you are authorizing the token to
     * use." The first version of this file emitted no scope at all, which Apple's own example payload
     * carries — a token that may be honoured for compatibility today and is not what the spec asks for.
     */
    it('carries the browser scope by default, because that is what this repo needs', () => {
        const { payload } = parts(mintMapKitToken(BASE).token);
        expect(payload.scope).toBe('mapkit_js');
        expect(DEFAULT_SCOPE).toBe('mapkit_js');
    });

    it('knows exactly Apple’s four documented scope values', () => {
        expect(SCOPES).toEqual(['embed_api', 'mapkit_js', 'server_api', 'web_snapshots']);
    });

    it('accepts a space-separated combination', () => {
        const { payload } = parts(mintMapKitToken({ ...BASE, scope: 'mapkit_js web_snapshots' }).token);
        expect(payload.scope).toBe('mapkit_js web_snapshots');
    });

    it('refuses a scope Apple does not define, rather than minting a token that cannot work', () => {
        expect(() => mintMapKitToken({ ...BASE, scope: 'maps_js' })).toThrow(/unknown scope "maps_js"/);
        expect(() => mintMapKitToken({ ...BASE, scope: 'mapkit_js nonsense' })).toThrow(/unknown scope/);
    });

    /** server_api is not a browser scope, so Apple does not require an origin for it. */
    it('allows a server_api token with no origin', () => {
        const { payload } = parts(mintMapKitToken({ ...BASE, origin: undefined, scope: 'server_api' }).token);
        expect('origin' in payload).toBe(false);
        expect(payload.scope).toBe('server_api');
    });

    // MARK: - the origin claim

    /**
     * Apple: "Use a domain pattern such as `*.example.com`, a specific domain such as `example.com`, or a
     * comma-separated list of origins for multiple domains such as `example.com,*.subdomain.com`."
     *
     * No scheme appears anywhere in Apple's spec or example payload.
     */
    it.each([
        'akashic.no',
        '*.akashic.no',
        'akashic.no,*.akashic.no',
        'example.co.uk',
    ])('carries the documented bare-domain form %s untouched', good => {
        const { payload } = parts(mintMapKitToken({ ...BASE, origin: good }).token);
        expect(payload.origin).toBe(good);
    });

    /**
     * **The one that would have broken production**, and the only claim here proven against Apple rather
     * than read off a page.
     *
     * MEASURED 2026-07-27 against `cdn.apple-mapkit.com/ma/bootstrap` with the real key: a bare domain
     * and a wildcard are DISJOINT. `akashic.no` is 401 ORIGIN_CHECK_FAILURE from `sub.akashic.no`, and
     * `*.akashic.no` is 401 from the apex. The site serves from both — www.akashic.no is a CNAME to
     * chaerem.github.io and resolves — so either form alone leaves half the visitors at an empty box.
     * Only the list covers it.
     */
    it('accepts the list form that is the only one covering both apex and www', () => {
        const { payload } = parts(mintMapKitToken({ ...BASE, origin: 'akashic.no,*.akashic.no' }).token);
        expect(payload.origin).toBe('akashic.no,*.akashic.no');
    });

    /**
     * The first version of the minter *enforced* a scheme, so it threw on `akashic.no` — the documented
     * value — and accepted `https://akashic.no`, which Apple documents nowhere. The justification was the
     * CloudKit trailing-slash trap, where Allowed Origins IS matched against an HTTP `Origin` header and
     * therefore does need the scheme. Same word, two Apple services, opposite formats.
     *
     * Worth being accurate about the stakes, since I overstated them once already: MEASURED, Apple returns
     * **200** for a scheme-form origin. It is tolerated, not rejected. So this guard is about writing to
     * the spec rather than to what the server currently forgives — and the error message names the remedy
     * rather than the rule, because anyone hitting it is hitting it from the CloudKit instinct.
     */
    it.each([
        'https://akashic.no',
        'http://localhost:5173',
        'HTTPS://AKASHIC.NO',
    ])('refuses the URL form %s and says to drop the scheme', bad => {
        expect(() => mintMapKitToken({ ...BASE, origin: bad })).toThrow(/bare domain, not a URL/);
    });

    it('explains that CloudKit is the opposite, since that is where the wrong instinct comes from', () => {
        expect(() => mintMapKitToken({ ...BASE, origin: 'https://akashic.no' }))
            .toThrow(/CloudKit's Allowed Origins is the opposite/);
    });

    it.each([
        'akashic.no/',
        'akashic.no/path',
        'akashic.no/?journey=x',
    ])('refuses %s, because a path is not part of an origin', bad => {
        expect(() => mintMapKitToken({ ...BASE, origin: bad })).toThrow(/path or trailing slash/);
    });

    it.each([
        ['a bare word with no dot', 'akashic'],
        ['an empty entry', 'akashic.no,'],
        ['a leading empty entry', ',akashic.no'],
        ['an underscore', 'akashic_no.example'],
        ['a mid-label wildcard', 'ak*.akashic.no'],
    ])('refuses %s', (_name, bad) => {
        expect(() => mintMapKitToken({ ...BASE, origin: bad })).toThrow();
    });

    it('refuses padded list entries rather than trimming them, so the token matches what was written', () => {
        expect(() => mintMapKitToken({ ...BASE, origin: 'akashic.no, *.akashic.no' }))
            .toThrow(/whitespace/);
    });

    /**
     * `localhost` has no dot, so it does not match Apple's "specific domain" shape and Apple documents
     * nothing about it — but the dev loop and Playwright serve from `http://localhost:5173`.
     * MEASURED 2026-07-27: both `localhost` alone and `akashic.no,localhost` return 200 for a request from
     * `http://localhost:5173`, so this is verified rather than hoped. The port is not part of the claim.
     */
    it.each(['localhost', 'akashic.no,localhost'])('allows %s, measured working against Apple', origin => {
        const { payload } = parts(mintMapKitToken({ ...BASE, origin }).token);
        expect(payload.origin).toBe(origin);
    });

    /**
     * Apple's spec requires an origin whenever the scope runs in a browser, so the minter does too.
     *
     * Measured, the server is more forgiving than its spec: a token with NO origin claim is served 200
     * from a matching site. Enforcing it anyway is deliberate — the claim is the only thing standing
     * between a public bundle token and anyone reusing it in a browser, and "the server currently lets it
     * through" is not a property to build on.
     */
    it.each(['mapkit_js', 'web_snapshots', 'embed_api'])(
        'refuses to mint a %s token with no origin at all', scope => {
            expect(() => mintMapKitToken({ ...BASE, origin: undefined, scope }))
                .toThrow(/requires an origin claim/);
        });

    // MARK: - the key itself

    it.each([
        ['keyId', { keyId: '' }],
        ['teamId', { teamId: '' }],
        ['privateKey', { privateKey: '' }],
    ])('refuses to mint without %s', (_name, override) => {
        expect(() => mintMapKitToken({ ...BASE, ...override })).toThrow();
    });

    /**
     * The commonest secret-handling mistake: literal backslash-n instead of newlines.
     *
     * Note what this caught. The first version of the guard only checked for a "BEGIN PRIVATE KEY" header —
     * which SURVIVES newline mangling, so a mangled key sailed past it and died inside OpenSSL as
     * `DECODER routines::unsupported`, a message naming nothing the reader can act on. The escaped-newline
     * case therefore needs its own check, separate from the header check.
     */
    it('names escaped newlines specifically, not just a missing PEM header', () => {
        const mangled = privateKey.replace(/\n/g, '\\n');
        expect(mangled).toContain('BEGIN PRIVATE KEY');   // the header alone cannot detect this
        expect(() => mintMapKitToken({ ...BASE, privateKey: mangled }))
            .toThrow(/literal backslash-n/);
    });

    it('still reports a genuinely non-PEM key as a missing header', () => {
        expect(() => mintMapKitToken({ ...BASE, privateKey: 'clearly not a key' }))
            .toThrow(/BEGIN PRIVATE KEY/);
    });

    /** Anything OpenSSL rejects must arrive with context, not a bare error code. */
    it('wraps an undecodable key in a message that says what was expected', () => {
        const broken = '-----BEGIN PRIVATE KEY-----\nZm9vYmFy\n-----END PRIVATE KEY-----\n';
        expect(() => mintMapKitToken({ ...BASE, privateKey: broken }))
            .toThrow(/AuthKey_<keyId>\.p8/);
    });

    it.each([0, -1])('refuses a %s-day lifetime', days => {
        expect(() => mintMapKitToken({ ...BASE, days })).toThrow(/days must be positive/);
    });
});

describe('the CI expiry guard', () => {
    it('reports the remaining days so a build can fail before the token lapses', () => {
        const { token } = mintMapKitToken({ ...BASE, days: 20 });
        expect(daysUntilExpiry(token, BASE.now)).toBeCloseTo(20, 5);
    });

    it('goes negative once expired, so a threshold test cannot read as healthy', () => {
        const { token } = mintMapKitToken({ ...BASE, days: 1 });
        const twoDaysLater = BASE.now + 2 * 86400 * 1000;
        expect(daysUntilExpiry(token, twoDaysLater)).toBeLessThan(0);
    });

    it('decodes the payload without needing the key', () => {
        const { token } = mintMapKitToken(BASE);
        expect(decodePayload(token)).toMatchObject({
            iss: '9LVCB72DT8',
            origin: 'akashic.no',
            scope: 'mapkit_js',
        });
    });

    it.each(['', 'not-a-jwt', 'only.two'])('rejects %s rather than reporting a healthy token', bad => {
        expect(() => daysUntilExpiry(bad)).toThrow();
    });
});
