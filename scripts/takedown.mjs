#!/usr/bin/env node
/**
 * Public-showcase takedown (SHIP-08 / COMMERCIALIZATION-PLAN §4.5).
 *
 * Removes one published journey's mirror from the **public** CloudKit database — the
 * `PublicJourney` metadata record plus every `PublicPhoto` thumbnail joined to it. This is the
 * operator half of moderation: `src/components/public/ReportLink.tsx` gives a visitor a prefilled
 * mailto to `report@akashic.no`, and this script is what the owner runs after triaging one.
 * There is no backend to build a moderation console into, and App Review Guideline 1.2 asks for a
 * takedown mechanism, not a web app.
 *
 * ## Default is dry-run
 *
 * Nothing is deleted without `--apply`. A takedown is irreversible (the owner's device can
 * re-publish, but the operator cannot undo), and the input is a slug typed out of an email by a
 * human, so the cheap safety is to make the destructive form the one you have to ask for.
 *
 * ## Why a slug is not a record name — the DIFF-01 trap
 *
 * The public keyspace is shared across every iCloud user, so two families can both mint the slug
 * `kilimanjaro` locally. `PublicMirrorPublisher.resolveEffectiveSlug` handles the collision by
 * publishing the second one under an owner-scoped `kilimanjaro-a1b2c3`
 * (`PublicMirrorBuilder.disambiguatedSlug`: base + 6 hex of an FNV-1a hash of `slug|owner`), and
 * `publish` then assigns that effective slug onto the record it writes — so for a published mirror
 * `recordName == slug field == journeySlug on its photos`, and all three can be the disambiguated
 * form while the journey inside the app still calls itself `kilimanjaro`.
 *
 * DIFF-01 was exactly this bug on the app side: unpublish swept only the pretty slug, CloudKit
 * treats deleting an absent record as success, so it reported OK while the real records stayed
 * world-readable. A takedown script that trusts the reported slug reintroduces it. The app can
 * recompute the suffix because it knows its own owner record name; this script cannot, so it
 * **discovers** instead:
 *
 *   1. `records/lookup` on the reported name (the common case — the mirror is under it).
 *   2. `records/query` `slug EQUALS <reported>` (insurance against a record whose slug field and
 *      recordName ever disagree; costs one request).
 *   3. `records/query` `slug BEGINS_WITH "<reported>-"`, filtered to `^<reported>-[0-9a-f]{6}$` —
 *      this is the one that finds the disambiguated mirror.
 *
 * Discovery is deliberately wider than deletion. Deletion targets only records whose name is the
 * reported slug or an owner-disambiguated variant *of the reported slug* — never the other
 * direction. Given `kilimanjaro-a1b2c3` it will not touch `kilimanjaro`, because that bare slug
 * belongs to whichever family got there first and is somebody else's content.
 *
 * When more than one record survives that filter the slug is genuinely ambiguous (two families
 * published the same name; the report email and the showcase URL both say only `kilimanjaro`). The
 * script refuses and prints the candidates with owner and dates so the operator can pick one with
 * `--record-name`, or sweep them all with `--all`.
 *
 * ## Credentials
 *
 * CloudKit Web Services authenticates server-to-server requests with an ECDSA key pair you create
 * yourself; Apple never issues a secret. Nothing is embedded here and nothing is defaulted — see
 * `printCredentialHelp` for what the owner has to create, and `docs/store/review-notes.md` for
 * where this sits in the moderation story.
 *
 * ## Usage
 *
 *   node scripts/takedown.mjs --dry-run kilimanjaro        # default; prints the plan
 *   node scripts/takedown.mjs --apply  kilimanjaro-a1b2c3  # actually deletes
 *   node scripts/takedown.mjs --apply --record-name kilimanjaro-a1b2c3 kilimanjaro
 *   node scripts/takedown.mjs --env development --dry-run kilimanjaro
 *
 * The pure parts (argument parsing, slug-candidate derivation, plan formatting, chunking, the
 * signing message) are exported and covered by `scripts/takedown.test.mjs`. The live database is
 * not testable from here and is not touched by the tests.
 */

import { createHash, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { argv, env, exit, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Constants — mirrors of values that already exist elsewhere in the repo
// ---------------------------------------------------------------------------

/** Same container as `Config.cloudKitContainerIdentifier` and `src/lib/cloudkit.ts`. */
export const DEFAULT_CONTAINER_ID = 'iCloud.no.akashic';
export const JOURNEY_TYPE = 'PublicJourney';
export const PHOTO_TYPE = 'PublicPhoto';
export const API_HOST = 'https://api.apple-cloudkit.com';
export const API_VERSION = '1';
export const DATABASE = 'public';

/** CloudKit Web Services caps a records/modify at 200 operations and a query at 200 results. */
export const MAX_OPERATIONS_PER_REQUEST = 200;
export const QUERY_PAGE_SIZE = 200;

/**
 * The shape `PublicMirrorBuilder.disambiguatedSlug` appends: `-` + 6 lowercase hex characters
 * (`String(format: "%06x", hash & 0xffffff)`). Anchored, because the whole point is to
 * distinguish `kilimanjaro-a1b2c3` from an honest slug like `kilimanjaro-crater-route`.
 */
export const DISAMBIGUATION_SUFFIX = /-[0-9a-f]{6}$/;

/** Environment variable names, in one place so the error messages cannot drift from the reads. */
export const ENV_VARS = {
    keyId: 'CLOUDKIT_KEY_ID',
    privateKey: 'CLOUDKIT_PRIVATE_KEY',
    privateKeyPath: 'CLOUDKIT_PRIVATE_KEY_PATH',
    container: 'CLOUDKIT_CONTAINER',
};

// ---------------------------------------------------------------------------
// Argument parsing (pure)
// ---------------------------------------------------------------------------

const USAGE = `Akashic public-showcase takedown

  node scripts/takedown.mjs [options] <slug>

  <slug>                The reported journey slug, in either form: the pretty slug
                        (kilimanjaro) or the owner-disambiguated one (kilimanjaro-a1b2c3).

Options
  --dry-run             Print the plan and delete nothing. THIS IS THE DEFAULT.
  --apply               Actually delete. Required for any destructive action.
  --record-name <name>  Delete only this exact record name. Use when a slug resolves
                        to more than one published journey.
  --all                 When a slug resolves to more than one journey, take down every
                        match instead of refusing.
  --env <name>          CloudKit environment: production (default) or development.
  --container <id>      Container override. Default ${DEFAULT_CONTAINER_ID}.
  -h, --help            This text.

Credentials come from the environment; run with --dry-run and no credentials to see what
to create.`;

/**
 * Parse argv (the two node prefix entries already stripped by the caller).
 *
 * Returns errors rather than throwing or exiting so the whole surface is testable. `dryRun`
 * starts true and only `--apply` clears it: a typo in a flag name must never turn a dry run
 * into a deletion.
 */
export function parseArgs(args) {
    const options = {
        slug: null,
        dryRun: true,
        apply: false,
        all: false,
        recordName: null,
        environment: 'production',
        // null, not the default, so `resolveContainer` can tell "not asked for" from "asked for
        // the default" and let an explicit --container beat the environment variable.
        container: null,
        help: false,
        errors: [],
    };

    /** `--flag value` and `--flag=value` both, so neither habit is a silent failure. */
    const takeValue = (name, inlineValue, index) => {
        if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };
        const next = args[index + 1];
        if (next === undefined || next.startsWith('-')) {
            options.errors.push(`${name} needs a value`);
            return { value: null, nextIndex: index };
        }
        return { value: next, nextIndex: index + 1 };
    };

    let sawDryRunFlag = false;

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        const eq = arg.indexOf('=');
        const name = arg.startsWith('--') && eq !== -1 ? arg.slice(0, eq) : arg;
        const inline = arg.startsWith('--') && eq !== -1 ? arg.slice(eq + 1) : undefined;

        switch (name) {
            case '-h':
            case '--help':
                options.help = true;
                break;
            case '--dry-run':
                sawDryRunFlag = true;
                break;
            case '--apply':
                options.apply = true;
                options.dryRun = false;
                break;
            case '--all':
                options.all = true;
                break;
            case '--record-name': {
                const { value, nextIndex } = takeValue(name, inline, i);
                if (value !== null) options.recordName = value;
                i = nextIndex;
                break;
            }
            case '--env': {
                const { value, nextIndex } = takeValue(name, inline, i);
                if (value !== null) {
                    if (value !== 'production' && value !== 'development') {
                        options.errors.push(`--env must be production or development, got "${value}"`);
                    } else {
                        options.environment = value;
                    }
                }
                i = nextIndex;
                break;
            }
            case '--container': {
                const { value, nextIndex } = takeValue(name, inline, i);
                if (value !== null) options.container = value;
                i = nextIndex;
                break;
            }
            default:
                if (arg.startsWith('-')) {
                    options.errors.push(`unknown option "${arg}"`);
                } else if (options.slug !== null) {
                    options.errors.push(`unexpected second slug "${arg}"`);
                } else {
                    options.slug = arg;
                }
        }
    }

    if (sawDryRunFlag && options.apply) {
        options.errors.push('--dry-run and --apply contradict each other');
    }
    if (!options.help && !options.slug) {
        options.errors.push('a journey slug is required');
    }

    return options;
}

/** Precedence: explicit `--container` flag, then `CLOUDKIT_CONTAINER`, then the app's container. */
export function resolveContainer(options, source = env) {
    return options.container || source[ENV_VARS.container] || DEFAULT_CONTAINER_ID;
}

// ---------------------------------------------------------------------------
// Slug candidates (pure) — the DIFF-01 half
// ---------------------------------------------------------------------------

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Work out what to look for, and what may be deleted, from one reported slug.
 *
 * `queries` widen discovery; `accepts` narrows deletion. Keeping those two separate is the whole
 * safety property: a report naming `kilimanjaro` must reach `kilimanjaro-a1b2c3`, and a report
 * naming `kilimanjaro-a1b2c3` must NOT reach `kilimanjaro`, which belongs to a different family.
 *
 * `baseSlug` / `looksDisambiguated` are reported to the operator as context only. They never
 * widen `accepts` — `bee-facade` is a perfectly legal pretty slug whose last six characters
 * happen to be hex, and stripping it to `bee` to sweep siblings would be a way to delete a
 * stranger's journey by coincidence.
 */
export function deriveSlugCandidates(reported) {
    const slug = String(reported ?? '').trim();
    const looksDisambiguated = DISAMBIGUATION_SUFFIX.test(slug);
    const baseSlug = looksDisambiguated ? slug.replace(DISAMBIGUATION_SUFFIX, '') : slug;
    const variantPattern = new RegExp(`^${escapeRegExp(slug)}-[0-9a-f]{6}$`);

    return {
        slug,
        baseSlug,
        looksDisambiguated,
        variantPattern,
        /** The exact record name to `records/lookup`. */
        lookupRecordName: slug,
        /** Query filters to run against `PublicJourney.slug` (QUERYABLE in schema.ckdb). */
        queries: [
            { comparator: 'EQUALS', value: slug },
            { comparator: 'BEGINS_WITH', value: `${slug}-` },
        ],
        /** True when a discovered record name is in scope for deletion. */
        accepts(recordName) {
            if (typeof recordName !== 'string' || recordName === '') return false;
            return recordName === slug || variantPattern.test(recordName);
        },
    };
}

/** Split into fixed-size chunks — mirrors `PublicMirrorPublisher.chunked`. */
export function chunked(items, size) {
    if (!(size > 0)) return items.length === 0 ? [] : [items];
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

// ---------------------------------------------------------------------------
// Plan formatting (pure)
// ---------------------------------------------------------------------------

/**
 * Render the plan the operator reads before (and instead of) a deletion.
 *
 * A dry run whose output does not name every record it would remove is not a dry run, so this
 * lists record names in full rather than only counting them.
 */
export function formatPlan(plan) {
    const { reportedSlug, container, environment, journeys, related, dryRun, ambiguous } = plan;
    const lines = [];

    // An ambiguous slug is refused, so it reads in the same non-deleting voice as a dry run even
    // under --apply. The first draft printed "APPLYING … Deleting 4 records" and only then said it
    // was refusing, which is the one thing this output must never get wrong.
    const willDelete = !dryRun && !ambiguous;

    lines.push(willDelete
        ? 'Akashic public-showcase takedown — APPLYING'
        : 'Akashic public-showcase takedown — DRY RUN, nothing will be deleted');
    lines.push(`  container    ${container}`);
    lines.push(`  environment  ${environment}`);
    lines.push(`  database     ${DATABASE}`);
    lines.push(`  reported     ${reportedSlug}`);
    lines.push('');

    if (journeys.length === 0) {
        lines.push(`No ${JOURNEY_TYPE} record matches "${reportedSlug}".`);
        lines.push('Nothing to take down. The mirror may already have been unpublished from the app.');
        if (related.length > 0) {
            lines.push('');
            lines.push('Records found nearby but deliberately NOT in scope:');
            for (const r of related) lines.push(`  ${describeJourney(r)}`);
        }
        return lines.join('\n');
    }

    lines.push(`${journeys.length} ${JOURNEY_TYPE} record${journeys.length === 1 ? '' : 's'} in scope:`);
    let totalPhotos = 0;
    for (const journey of journeys) {
        lines.push(`  ${describeJourney(journey)}`);
        const photos = journey.photoRecordNames ?? [];
        totalPhotos += photos.length;
        lines.push(`    ${photos.length} ${PHOTO_TYPE} record${photos.length === 1 ? '' : 's'}`);
        for (const name of photos) lines.push(`      ${name}`);
    }

    const totalRecords = journeys.length + totalPhotos;
    // Photos and journeys are deleted in separate passes (see main), so the request count is the
    // sum of the two chunkings, not one chunking of the total.
    const requests = Math.ceil(totalPhotos / MAX_OPERATIONS_PER_REQUEST)
        + Math.ceil(journeys.length / MAX_OPERATIONS_PER_REQUEST);
    lines.push('');
    lines.push(`${willDelete ? 'Deleting' : 'Would delete'} ${totalRecords} record${totalRecords === 1 ? '' : 's'} `
        + `(${journeys.length} journey, ${totalPhotos} photo) in ${requests} request${requests === 1 ? '' : 's'}.`);

    if (related.length > 0) {
        lines.push('');
        lines.push('Records found nearby but deliberately NOT in scope (a different owner may hold them):');
        for (const r of related) lines.push(`  ${describeJourney(r)}`);
        lines.push('Re-run naming one of these directly if the report meant one of them.');
    }

    if (ambiguous) {
        lines.push('');
        lines.push(`REFUSING TO DELETE: "${reportedSlug}" resolves to ${journeys.length} published journeys.`);
        lines.push('Two families can publish the same slug, and the report email cannot tell them apart.');
        lines.push('Pick one with --record-name <name>, or pass --all to take down every match.');
    } else if (dryRun) {
        lines.push('');
        lines.push('Re-run with --apply to delete.');
    }

    return lines.join('\n');
}

function describeJourney(journey) {
    const bits = [journey.recordName];
    if (journey.name) bits.push(`"${journey.name}"`);
    if (journey.country) bits.push(journey.country);
    if (journey.dateStarted) bits.push(journey.dateStarted);
    if (journey.createdBy) bits.push(`owner ${journey.createdBy}`);
    return bits.join('  ');
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * The clear, named failure the task asks for. No credential is ever defaulted or guessed: an
 * invented key id would turn a missing-setup error into an opaque 401 against the live database.
 */
export class MissingCredentialsError extends Error {
    constructor(missing) {
        super(`Missing CloudKit server-to-server credentials: ${missing.join(', ')}`);
        this.name = 'MissingCredentialsError';
        this.missing = missing;
    }
}

/**
 * Read the server-to-server key from the environment. Pure with respect to `source` so tests can
 * pass a plain object; only the key-file read touches the filesystem.
 */
export function readCredentials(source = env, readFile = readFileSync) {
    const missing = [];
    const keyId = source[ENV_VARS.keyId];
    if (!keyId) missing.push(ENV_VARS.keyId);

    let privateKey = source[ENV_VARS.privateKey] ?? null;
    const keyPath = source[ENV_VARS.privateKeyPath];
    if (!privateKey && keyPath) privateKey = readFile(keyPath, 'utf8');
    if (!privateKey) missing.push(`${ENV_VARS.privateKey} or ${ENV_VARS.privateKeyPath}`);

    if (missing.length > 0) throw new MissingCredentialsError(missing);
    return { keyId, privateKey };
}

export function credentialHelpText() {
    return [
        'CloudKit Web Services needs a server-to-server key. Nothing is embedded in this script and',
        'nothing is defaulted. Create it once, as the container owner:',
        '',
        '  1. Generate an EC P-256 key pair locally (the private key never leaves your machine):',
        '       openssl ecparam -name prime256v1 -genkey -noout -out akashic-takedown.key',
        '       openssl ec -in akashic-takedown.key -pubout -out akashic-takedown.pub',
        '  2. CloudKit Console > Akashic container > Settings > Tokens & Keys >',
        '     Server-to-Server Keys > add key, paste the contents of akashic-takedown.pub.',
        '     Apple shows a Key ID. That is the only thing it gives you.',
        '  3. Keep the .key file outside the repo (it is a credential, and the repo is public-facing),',
        '     then point this script at it:',
        `       export ${ENV_VARS.keyId}=<the Key ID from step 2>`,
        `       export ${ENV_VARS.privateKeyPath}=/absolute/path/to/akashic-takedown.key`,
        '',
        `Alternatives: ${ENV_VARS.privateKey} may hold the PEM text directly (handy in CI, worse in a`,
        `shell history), and ${ENV_VARS.container} overrides the container id.`,
        '',
        'The key grants write access to the PUBLIC database of the container. It cannot read any',
        "family's private database. Revoke it in the same Console screen if it leaks.",
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Request signing
// ---------------------------------------------------------------------------

/** `/database/1/<container>/<environment>/public/<operation>` — also the signed subpath. */
export function requestSubpath({ container, environment, operation }) {
    return `/database/${API_VERSION}/${container}/${environment}/${DATABASE}/${operation}`;
}

/** CloudKit wants seconds precision and a literal Z; `toISOString()` includes milliseconds. */
export function iso8601(date) {
    return `${date.toISOString().split('.')[0]}Z`;
}

/**
 * The exact string CloudKit signs: `<date>:<base64 sha256 of body>:<subpath>`.
 * Pure and exported because getting this wrong produces a 401 with no hint about which of the
 * three parts is wrong, and a unit test is much cheaper than that round trip.
 */
export function signingMessage({ date, body, subpath }) {
    const hashed = createHash('sha256').update(body, 'utf8').digest('base64');
    return `${date}:${hashed}:${subpath}`;
}

function signRequest({ credentials, date, body, subpath }) {
    const message = signingMessage({ date, body, subpath });
    // ECDSA over SHA-256, DER-encoded, base64 — which is what createSign emits for an EC key.
    return createSign('sha256').update(message).sign(credentials.privateKey, 'base64');
}

// ---------------------------------------------------------------------------
// CloudKit client
// ---------------------------------------------------------------------------

function makeClient({ credentials, container, environment, fetchImpl = fetch }) {
    return async function call(operation, payload) {
        const body = JSON.stringify(payload);
        const subpath = requestSubpath({ container, environment, operation });
        const date = iso8601(new Date());
        const response = await fetchImpl(`${API_HOST}${subpath}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Apple-CloudKit-Request-KeyID': credentials.keyId,
                'X-Apple-CloudKit-Request-ISO8601Date': date,
                'X-Apple-CloudKit-Request-SignatureV1': signRequest({ credentials, date, body, subpath }),
            },
            body,
        });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`CloudKit ${operation} failed: ${response.status} ${response.statusText}\n${text}`);
        }
        return text === '' ? {} : JSON.parse(text);
    };
}

/** Field values arrive as `{ value, type }`; missing fields are simply absent. */
function fieldValue(record, name) {
    return record?.fields?.[name]?.value ?? null;
}

function toJourneySummary(record) {
    const started = fieldValue(record, 'dateStarted');
    return {
        recordName: record.recordName,
        name: fieldValue(record, 'name'),
        country: fieldValue(record, 'country'),
        // TIMESTAMP comes back as epoch milliseconds.
        dateStarted: typeof started === 'number' ? new Date(started).toISOString().slice(0, 10) : null,
        createdBy: record?.created?.userRecordName ?? null,
    };
}

const JOURNEY_DESIRED_KEYS = ['slug', 'name', 'country', 'dateStarted'];

/**
 * Every `PublicJourney` record reachable from the reported slug, deduplicated by record name and
 * split into `accepted` (in scope for deletion) and `related` (found, reported, left alone).
 */
async function discoverJourneys(call, candidates) {
    const found = new Map();

    // An absent record comes back as a per-record `serverErrorCode` inside a 200, so anything this
    // call throws is a real transport/auth failure and is deliberately not caught here.
    const lookup = await call('records/lookup', {
        records: [{ recordName: candidates.lookupRecordName }],
        desiredKeys: JOURNEY_DESIRED_KEYS,
    });
    for (const record of lookup.records ?? []) {
        // Absent records carry a serverErrorCode and no recordType.
        if (record.serverErrorCode || record.recordType !== JOURNEY_TYPE) continue;
        found.set(record.recordName, toJourneySummary(record));
    }

    for (const { comparator, value } of candidates.queries) {
        let continuationMarker;
        do {
            const payload = {
                query: {
                    recordType: JOURNEY_TYPE,
                    filterBy: [{ fieldName: 'slug', comparator, fieldValue: { value } }],
                },
                desiredKeys: JOURNEY_DESIRED_KEYS,
                resultsLimit: QUERY_PAGE_SIZE,
            };
            if (continuationMarker) payload.continuationMarker = continuationMarker;
            const page = await call('records/query', payload);
            for (const record of page.records ?? []) {
                if (record.serverErrorCode) continue;
                if (!found.has(record.recordName)) found.set(record.recordName, toJourneySummary(record));
            }
            continuationMarker = page.continuationMarker;
        } while (continuationMarker);
    }

    const accepted = [];
    const related = [];
    for (const summary of found.values()) {
        (candidates.accepts(summary.recordName) ? accepted : related).push(summary);
    }
    accepted.sort((a, b) => a.recordName.localeCompare(b.recordName));
    related.sort((a, b) => a.recordName.localeCompare(b.recordName));
    return { accepted, related };
}

/**
 * Every `PublicPhoto` record name for one journey record name, following the continuation marker.
 * One page is never the answer — Kilimanjaro alone is 939 photos.
 */
async function photoRecordNames(call, journeyRecordName) {
    const names = [];
    let continuationMarker;
    do {
        const payload = {
            query: {
                recordType: PHOTO_TYPE,
                filterBy: [
                    { fieldName: 'journeySlug', comparator: 'EQUALS', fieldValue: { value: journeyRecordName } },
                ],
            },
            // Names are all we delete by; asking for no fields keeps the pages small.
            desiredKeys: [],
            resultsLimit: QUERY_PAGE_SIZE,
        };
        if (continuationMarker) payload.continuationMarker = continuationMarker;
        const page = await call('records/query', payload);
        for (const record of page.records ?? []) {
            if (!record.serverErrorCode && record.recordName) names.push(record.recordName);
        }
        continuationMarker = page.continuationMarker;
    } while (continuationMarker);
    return names;
}

/**
 * Delete record names in chunks. `forceDelete` because the mirror is last-writer-wins with a
 * single writer — there is no change tag to reconcile, exactly as on the app side.
 */
async function deleteRecords(call, recordNames) {
    let deleted = 0;
    const failures = [];
    for (const chunk of chunked(recordNames, MAX_OPERATIONS_PER_REQUEST)) {
        const result = await call('records/modify', {
            operations: chunk.map((recordName) => ({
                operationType: 'forceDelete',
                record: { recordName },
            })),
        });
        for (const record of result.records ?? []) {
            if (record.serverErrorCode) {
                failures.push(`${record.recordName ?? '?'}: ${record.serverErrorCode} ${record.reason ?? ''}`.trim());
            } else {
                deleted += 1;
            }
        }
    }
    return { deleted, failures };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function main(args, out = stdout) {
    const write = (text) => out.write(`${text}\n`);
    const options = parseArgs(args);

    if (options.help) {
        write(USAGE);
        return 0;
    }
    if (options.errors.length > 0) {
        for (const error of options.errors) write(`error: ${error}`);
        write('');
        write(USAGE);
        return 2;
    }

    const container = resolveContainer(options);

    let credentials;
    try {
        credentials = readCredentials();
    } catch (err) {
        if (!(err instanceof MissingCredentialsError)) throw err;
        write(`error: ${err.message}`);
        write('');
        write(credentialHelpText());
        return 1;
    }

    const candidates = deriveSlugCandidates(options.slug);
    const call = makeClient({ credentials, container, environment: options.environment });

    const { accepted, related } = await discoverJourneys(call, candidates);

    let journeys = accepted;
    if (options.recordName) {
        journeys = accepted.filter((j) => j.recordName === options.recordName);
        if (journeys.length === 0) {
            write(`error: --record-name ${options.recordName} is not among the records `
                + `"${candidates.slug}" resolves to.`);
            if (accepted.length > 0) {
                write('Resolved record names:');
                for (const j of accepted) write(`  ${j.recordName}`);
            }
            return 1;
        }
    }

    const ambiguous = journeys.length > 1 && !options.all;

    for (const journey of journeys) {
        journey.photoRecordNames = await photoRecordNames(call, journey.recordName);
    }

    write(formatPlan({
        reportedSlug: candidates.slug,
        container,
        environment: options.environment,
        journeys,
        related,
        dryRun: options.dryRun,
        ambiguous,
    }));

    if (journeys.length === 0) return 0;
    if (ambiguous) return 1;
    if (options.dryRun) return 0;

    // Photos first, then the metadata record: if the run dies halfway the journey page is still
    // discoverable and re-runnable. The other order leaves orphaned world-readable thumbnails
    // with GPS and timestamps and nothing pointing at them.
    const photoNames = journeys.flatMap((j) => j.photoRecordNames ?? []);
    const photoResult = await deleteRecords(call, photoNames);
    const journeyResult = await deleteRecords(call, journeys.map((j) => j.recordName));

    write('');
    write(`Deleted ${photoResult.deleted}/${photoNames.length} ${PHOTO_TYPE} `
        + `and ${journeyResult.deleted}/${journeys.length} ${JOURNEY_TYPE} records.`);

    const failures = [...photoResult.failures, ...journeyResult.failures];
    if (failures.length > 0) {
        write(`${failures.length} record(s) failed:`);
        for (const failure of failures) write(`  ${failure}`);
        return 1;
    }

    write('Takedown complete. Reply to the reporter and note the slug in the moderation log.');
    return 0;
}

// Only run when executed directly, so the test file can import the pure parts.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
    main(argv.slice(2)).then(exit, (err) => {
        stdout.write(`error: ${err.message}\n`);
        exit(1);
    });
}
