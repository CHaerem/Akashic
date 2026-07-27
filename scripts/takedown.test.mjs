/**
 * Unit tests for the pure half of `scripts/takedown.mjs` (SHIP-08).
 *
 * The live public database cannot be exercised from here and deliberately is not: importing the
 * module has no side effects (the CLI entry point is guarded on `argv[1]`), and nothing below
 * constructs a client or touches the network. What is tested is everything that can be wrong
 * without a round trip — argument parsing, the slug-candidate derivation that DIFF-01 turned into
 * a known trap, the dry-run output, and the CloudKit signing message.
 *
 * Vitest globals are imported explicitly rather than relied on: `eslint.config.js` lints
 * `scripts/**` with node globals only, so `describe`/`it`/`expect` would be `no-undef` there.
 */

import { describe, expect, it } from 'vitest';

import {
    DATABASE,
    DEFAULT_CONTAINER_ID,
    ENV_VARS,
    MAX_OPERATIONS_PER_REQUEST,
    MissingCredentialsError,
    chunked,
    credentialHelpText,
    deriveSlugCandidates,
    formatPlan,
    iso8601,
    parseArgs,
    readCredentials,
    requestSubpath,
    resolveContainer,
    signingMessage,
} from './takedown.mjs';

describe('parseArgs', () => {
    it('defaults to a dry run', () => {
        const options = parseArgs(['kilimanjaro']);
        expect(options.errors).toEqual([]);
        expect(options.slug).toBe('kilimanjaro');
        expect(options.dryRun).toBe(true);
        expect(options.apply).toBe(false);
    });

    it('defaults to the production environment and asks for no container override', () => {
        const options = parseArgs(['kilimanjaro']);
        expect(options.environment).toBe('production');
        expect(options.container).toBeNull();
    });

    it('stays a dry run when --dry-run is passed explicitly', () => {
        expect(parseArgs(['--dry-run', 'kilimanjaro']).dryRun).toBe(true);
    });

    it('only --apply clears the dry run', () => {
        const options = parseArgs(['--apply', 'kilimanjaro']);
        expect(options.dryRun).toBe(false);
        expect(options.apply).toBe(true);
    });

    it('refuses --dry-run together with --apply rather than picking one', () => {
        const options = parseArgs(['--dry-run', '--apply', 'kilimanjaro']);
        expect(options.errors).toContain('--dry-run and --apply contradict each other');
    });

    it('treats an unknown flag as an error instead of as the slug', () => {
        // The failure this guards: `--aply kilimanjaro` must not silently become a dry run of a
        // journey named "--aply", nor an apply of kilimanjaro.
        const options = parseArgs(['--aply', 'kilimanjaro']);
        expect(options.errors).toContain('unknown option "--aply"');
        expect(options.dryRun).toBe(true);
    });

    it('requires a slug', () => {
        expect(parseArgs([]).errors).toContain('a journey slug is required');
        expect(parseArgs(['--dry-run']).errors).toContain('a journey slug is required');
    });

    it('does not require a slug for --help', () => {
        const options = parseArgs(['--help']);
        expect(options.help).toBe(true);
        expect(options.errors).toEqual([]);
    });

    it('rejects a second positional argument', () => {
        expect(parseArgs(['a', 'b']).errors).toContain('unexpected second slug "b"');
    });

    it('accepts --env in both spellings and rejects anything else', () => {
        expect(parseArgs(['--env', 'development', 's']).environment).toBe('development');
        expect(parseArgs(['--env=development', 's']).environment).toBe('development');
        expect(parseArgs(['--env', 'staging', 's']).errors)
            .toContain('--env must be production or development, got "staging"');
    });

    it('reads --record-name, --container and --all', () => {
        const options = parseArgs(['--all', '--record-name', 'kilimanjaro-a1b2c3',
            '--container=iCloud.test', 'kilimanjaro']);
        expect(options.all).toBe(true);
        expect(options.recordName).toBe('kilimanjaro-a1b2c3');
        expect(options.container).toBe('iCloud.test');
        expect(options.slug).toBe('kilimanjaro');
        expect(options.errors).toEqual([]);
    });

    it('errors when a value-taking flag is last', () => {
        expect(parseArgs(['kilimanjaro', '--record-name']).errors).toContain('--record-name needs a value');
    });
});

describe('resolveContainer', () => {
    it('falls back to the app container', () => {
        expect(resolveContainer(parseArgs(['s']), {})).toBe(DEFAULT_CONTAINER_ID);
    });

    it('honours CLOUDKIT_CONTAINER when no flag is given', () => {
        expect(resolveContainer(parseArgs(['s']), { [ENV_VARS.container]: 'iCloud.env' }))
            .toBe('iCloud.env');
    });

    it('lets an explicit --container beat the environment', () => {
        // The first draft had this backwards, so `--container` was silently ignored whenever
        // CLOUDKIT_CONTAINER happened to be exported.
        expect(resolveContainer(parseArgs(['--container', 'iCloud.flag', 's']),
            { [ENV_VARS.container]: 'iCloud.env' })).toBe('iCloud.flag');
    });
});

describe('deriveSlugCandidates', () => {
    it('accepts the pretty slug itself', () => {
        expect(deriveSlugCandidates('kilimanjaro').accepts('kilimanjaro')).toBe(true);
    });

    it('accepts an owner-disambiguated variant of the reported pretty slug (DIFF-01)', () => {
        // The bug this pins: a mirror published under `kilimanjaro-a1b2c3` must be reachable from
        // a report that only says `kilimanjaro`, or the records stay world-readable.
        const candidates = deriveSlugCandidates('kilimanjaro');
        expect(candidates.accepts('kilimanjaro-a1b2c3')).toBe(true);
        expect(candidates.accepts('kilimanjaro-000000')).toBe(true);
        expect(candidates.accepts('kilimanjaro-ffffff')).toBe(true);
    });

    it('does not mistake a longer honest slug for a disambiguated variant', () => {
        const candidates = deriveSlugCandidates('kilimanjaro');
        expect(candidates.accepts('kilimanjaro-crater-route')).toBe(false);
        // Five hex characters, seven hex characters, and uppercase are all not the suffix format.
        expect(candidates.accepts('kilimanjaro-a1b2c')).toBe(false);
        expect(candidates.accepts('kilimanjaro-a1b2c3d')).toBe(false);
        expect(candidates.accepts('kilimanjaro-A1B2C3')).toBe(false);
        expect(candidates.accepts('kilimanjaro-a1b2g3')).toBe(false);
    });

    it('does not walk from a disambiguated slug back to the bare one', () => {
        // The bare slug belongs to whichever family published first. Taking down
        // `kilimanjaro-a1b2c3` must never remove their `kilimanjaro`.
        const candidates = deriveSlugCandidates('kilimanjaro-a1b2c3');
        expect(candidates.accepts('kilimanjaro-a1b2c3')).toBe(true);
        expect(candidates.accepts('kilimanjaro')).toBe(false);
        expect(candidates.accepts('kilimanjaro-9f9f9f')).toBe(false);
    });

    it('reports the base slug and the suffix shape as context only', () => {
        const disambiguated = deriveSlugCandidates('kilimanjaro-a1b2c3');
        expect(disambiguated.looksDisambiguated).toBe(true);
        expect(disambiguated.baseSlug).toBe('kilimanjaro');

        const pretty = deriveSlugCandidates('kilimanjaro');
        expect(pretty.looksDisambiguated).toBe(false);
        expect(pretty.baseSlug).toBe('kilimanjaro');
    });

    it('does not widen deletion for a pretty slug whose tail happens to be hex', () => {
        // `bee-facade` is a legal slug and every one of "facade" is a hex digit. Stripping it to
        // `bee` to sweep siblings would delete a stranger's journey by coincidence.
        const candidates = deriveSlugCandidates('bee-facade');
        expect(candidates.looksDisambiguated).toBe(true);
        expect(candidates.baseSlug).toBe('bee');
        expect(candidates.accepts('bee-facade')).toBe(true);
        expect(candidates.accepts('bee')).toBe(false);
        expect(candidates.accepts('bee-a1b2c3')).toBe(false);
    });

    it('queries the slug field for both the exact value and the variant prefix', () => {
        const { queries, lookupRecordName } = deriveSlugCandidates('kilimanjaro');
        expect(lookupRecordName).toBe('kilimanjaro');
        expect(queries).toEqual([
            { comparator: 'EQUALS', value: 'kilimanjaro' },
            { comparator: 'BEGINS_WITH', value: 'kilimanjaro-' },
        ]);
    });

    it('trims whitespace pasted out of a report email', () => {
        expect(deriveSlugCandidates('  kilimanjaro \n').slug).toBe('kilimanjaro');
    });

    it('accepts nothing for an empty or absent slug', () => {
        for (const input of ['', '   ', null, undefined]) {
            const candidates = deriveSlugCandidates(input);
            expect(candidates.accepts('')).toBe(false);
            expect(candidates.accepts('kilimanjaro')).toBe(false);
        }
    });

    it('treats regex metacharacters in a slug literally', () => {
        const candidates = deriveSlugCandidates('a.c');
        expect(candidates.accepts('a.c')).toBe(true);
        expect(candidates.accepts('abc')).toBe(false);
    });
});

describe('chunked', () => {
    it('splits at the CloudKit request cap', () => {
        const names = Array.from({ length: 450 }, (_, i) => `p-${i}`);
        const chunks = chunked(names, MAX_OPERATIONS_PER_REQUEST);
        expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
    });

    it('returns no chunks for no records', () => {
        expect(chunked([], MAX_OPERATIONS_PER_REQUEST)).toEqual([]);
    });
});

describe('formatPlan', () => {
    const journey = {
        recordName: 'kilimanjaro-a1b2c3',
        name: 'Kilimanjaro',
        country: 'Tanzania',
        dateStarted: '2019-08-01',
        createdBy: '_ab12cd34',
        photoRecordNames: ['photo-1', 'photo-2'],
    };
    const base = {
        reportedSlug: 'kilimanjaro',
        container: DEFAULT_CONTAINER_ID,
        environment: 'production',
        journeys: [journey],
        related: [],
        dryRun: true,
        ambiguous: false,
    };

    it('says plainly that a dry run deletes nothing', () => {
        const output = formatPlan(base);
        expect(output).toContain('DRY RUN, nothing will be deleted');
        expect(output).toContain('Re-run with --apply to delete.');
    });

    it('names the container, environment and database it would act on', () => {
        const output = formatPlan(base);
        expect(output).toContain(DEFAULT_CONTAINER_ID);
        expect(output).toContain('production');
        expect(output).toContain(DATABASE);
    });

    it('names every record it would delete, not just a count', () => {
        const output = formatPlan(base);
        expect(output).toContain('kilimanjaro-a1b2c3');
        expect(output).toContain('photo-1');
        expect(output).toContain('photo-2');
        expect(output).toContain('Would delete 3 records (1 journey, 2 photo) in 2 requests.');
    });

    it('shows the disambiguated record name even though the report said the pretty slug', () => {
        const output = formatPlan(base);
        expect(output).toContain('reported     kilimanjaro');
        expect(output).toContain('kilimanjaro-a1b2c3  "Kilimanjaro"  Tanzania  2019-08-01  owner _ab12cd34');
    });

    it('drops the --apply hint and says APPLYING when it is not a dry run', () => {
        const output = formatPlan({ ...base, dryRun: false });
        expect(output).toContain('APPLYING');
        expect(output).not.toContain('Re-run with --apply');
        expect(output).toContain('Deleting 3 records');
    });

    it('explains itself when the slug matches nothing', () => {
        const output = formatPlan({ ...base, journeys: [] });
        expect(output).toContain('No PublicJourney record matches "kilimanjaro"');
        expect(output).toContain('Nothing to take down');
        expect(output).not.toContain('Would delete');
    });

    it('refuses, loudly, when one slug resolves to two families', () => {
        const output = formatPlan({
            ...base,
            journeys: [journey, { ...journey, recordName: 'kilimanjaro', createdBy: '_other' }],
            ambiguous: true,
        });
        expect(output).toContain('REFUSING TO DELETE');
        expect(output).toContain('Pick one with --record-name <name>, or pass --all');
        expect(output).not.toContain('Re-run with --apply to delete.');
    });

    it('never says APPLYING or Deleting when it is going to refuse', () => {
        // The first draft printed "APPLYING … Deleting 4 records" and only then the refusal.
        const output = formatPlan({
            ...base,
            dryRun: false,
            ambiguous: true,
            journeys: [journey, { ...journey, recordName: 'kilimanjaro', createdBy: '_other' }],
        });
        expect(output).not.toContain('APPLYING');
        expect(output).not.toContain('Deleting');
        expect(output).toContain('nothing will be deleted');
        expect(output).toContain('Would delete');
        expect(output).toContain('REFUSING TO DELETE');
    });

    it('lists out-of-scope neighbours so the operator can see what it left alone', () => {
        const output = formatPlan({
            ...base,
            related: [{ recordName: 'kilimanjaro-crater-route', name: 'Crater Route' }],
        });
        expect(output).toContain('deliberately NOT in scope');
        expect(output).toContain('kilimanjaro-crater-route');
    });

    it('singularises one record', () => {
        const output = formatPlan({
            ...base,
            journeys: [{ ...journey, photoRecordNames: [] }],
        });
        expect(output).toContain('1 PublicJourney record in scope');
        expect(output).toContain('0 PublicPhoto records');
        expect(output).toContain('Would delete 1 record (1 journey, 0 photo) in 1 request.');
    });
});

describe('readCredentials', () => {
    const KEY = '-----BEGIN EC PRIVATE KEY-----\nnot-a-real-key\n-----END EC PRIVATE KEY-----';

    it('names the missing variables rather than guessing a value', () => {
        try {
            readCredentials({});
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(MissingCredentialsError);
            expect(err.missing).toEqual([
                ENV_VARS.keyId,
                `${ENV_VARS.privateKey} or ${ENV_VARS.privateKeyPath}`,
            ]);
            expect(err.message).toContain('CLOUDKIT_KEY_ID');
        }
    });

    it('reports only the half that is missing', () => {
        expect(() => readCredentials({ [ENV_VARS.keyId]: 'ABC' }))
            .toThrow(/CLOUDKIT_PRIVATE_KEY or CLOUDKIT_PRIVATE_KEY_PATH/);
        expect(() => readCredentials({ [ENV_VARS.privateKey]: KEY }))
            .toThrow(/CLOUDKIT_KEY_ID/);
    });

    it('takes the PEM inline', () => {
        const creds = readCredentials({ [ENV_VARS.keyId]: 'ABC', [ENV_VARS.privateKey]: KEY });
        expect(creds).toEqual({ keyId: 'ABC', privateKey: KEY });
    });

    it('reads the PEM from a path, so the key need not be in the environment', () => {
        const reads = [];
        const creds = readCredentials(
            { [ENV_VARS.keyId]: 'ABC', [ENV_VARS.privateKeyPath]: '/keys/akashic.key' },
            (path, encoding) => { reads.push([path, encoding]); return KEY; },
        );
        expect(reads).toEqual([['/keys/akashic.key', 'utf8']]);
        expect(creds.privateKey).toBe(KEY);
    });

    it('prefers the inline PEM and never reads the file when it is set', () => {
        const creds = readCredentials(
            {
                [ENV_VARS.keyId]: 'ABC',
                [ENV_VARS.privateKey]: KEY,
                [ENV_VARS.privateKeyPath]: '/keys/akashic.key',
            },
            () => { throw new Error('must not read the file'); },
        );
        expect(creds.privateKey).toBe(KEY);
    });
});

describe('credentialHelpText', () => {
    it('tells the owner what to create and names every variable it reads', () => {
        const help = credentialHelpText();
        for (const name of Object.values(ENV_VARS)) expect(help).toContain(name);
        expect(help).toContain('prime256v1');
        expect(help).toContain('Server-to-Server Keys');
    });

    it('embeds no credential', () => {
        // A hardcoded key id or PEM in this file would be a leak in a public-facing repo.
        const help = credentialHelpText();
        expect(help).not.toMatch(/BEGIN (EC )?PRIVATE KEY/);
    });
});

describe('request signing', () => {
    it('builds the documented subpath', () => {
        expect(requestSubpath({
            container: DEFAULT_CONTAINER_ID,
            environment: 'production',
            operation: 'records/modify',
        })).toBe('/database/1/iCloud.no.akashic/production/public/records/modify');
    });

    it('formats the date to seconds with a literal Z', () => {
        // toISOString() yields milliseconds, which CloudKit rejects.
        expect(iso8601(new Date('2026-07-26T12:34:56.789Z'))).toBe('2026-07-26T12:34:56Z');
    });

    it('joins date, base64 body hash and subpath with colons', () => {
        const message = signingMessage({
            date: '2026-07-26T12:34:56Z',
            body: '{}',
            subpath: '/database/1/iCloud.no.akashic/production/public/records/query',
        });
        // base64(sha256("{}")) — a fixed value, so a change to the hash or the encoding fails here
        // rather than as an opaque 401 from Apple.
        expect(message).toBe('2026-07-26T12:34:56Z:'
            + 'RBNvo1WzZ4oRRq0W9+hknpT7T8If536DEMBg9hyq/4o=:'
            + '/database/1/iCloud.no.akashic/production/public/records/query');
    });

    it('hashes the body, so two different bodies never share a signature message', () => {
        const of = (body) => signingMessage({ date: 'd', body, subpath: 's' });
        expect(of('{"a":1}')).not.toBe(of('{"a":2}'));
    });
});
