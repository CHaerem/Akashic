import { describe, it, expect } from 'vitest';
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { mintMapKitToken, decodePayload, daysUntilExpiry, DEFAULT_DAYS } from './mintToken.mjs';

/**
 * MAP-04 — the token minter, tested without needing Apple's key.
 *
 * A generated P-256 key is cryptographically the same shape as an `AuthKey_*.p8`, so everything except
 * "does Apple accept it" is provable here. That last question needs the real key and is called out in
 * MAP-04; nothing in this file pretends to answer it.
 */

const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const BASE = { keyId: 'ABC1234567', teamId: '9LVCB72DT8', privateKey, now: 1_770_000_000_000 };

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

    it('omits the origin claim entirely when none is given, rather than sending an empty one', () => {
        const { payload } = parts(mintMapKitToken(BASE).token);
        expect('origin' in payload).toBe(false);
    });

    it('carries a well-formed origin through untouched', () => {
        const { payload } = parts(mintMapKitToken({ ...BASE, origin: 'https://akashic.no' }).token);
        expect(payload.origin).toBe('https://akashic.no');
    });

    /**
     * Refused rather than silently normalised. The CloudKit token's Allowed Origins had been entered as
     * `akashic.no/` with a trailing slash, which passed from a curl written to match the stored string and
     * failed from every real browser, because an HTTP `Origin` header never carries a path. Normalising
     * here would hide the same class of mistake instead of surfacing it.
     */
    it.each([
        'https://akashic.no/',
        'https://akashic.no/?journey=x',
        'akashic.no',
        'https://akashic.no/path',
    ])('refuses the malformed origin %s instead of correcting it', bad => {
        expect(() => mintMapKitToken({ ...BASE, origin: bad })).toThrow(/scheme:\/\/host/);
    });

    it('accepts http for localhost, which is where dev and Playwright live', () => {
        const { payload } = parts(mintMapKitToken({ ...BASE, origin: 'http://localhost:5173' }).token);
        expect(payload.origin).toBe('http://localhost:5173');
    });

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
        const { token } = mintMapKitToken({ ...BASE, origin: 'https://akashic.no' });
        expect(decodePayload(token)).toMatchObject({ iss: '9LVCB72DT8', origin: 'https://akashic.no' });
    });

    it.each(['', 'not-a-jwt', 'only.two'])('rejects %s rather than reporting a healthy token', bad => {
        expect(() => daysUntilExpiry(bad)).toThrow();
    });
});
