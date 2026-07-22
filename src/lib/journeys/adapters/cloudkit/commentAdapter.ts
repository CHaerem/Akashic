/**
 * CloudKit adapter — day comment reads + writes.
 *
 * Day comments are one of the plan's supported "light edits" on web, so
 * create/update/delete are implemented (not stubbed). Authors are stitched in
 * client-side from participant identities since CloudKit has no server joins.
 */

import type { DayComment, NewDayComment, DayCommentUpdate, CommentAuthor } from '../../types';
import { getSharedDatabase, getPrivateDatabase, getCloudKitSession } from '../../../cloudkit';
import { recordToDayComment, identityToProfile } from './records';
import { getJourneyMembers } from './memberAdapter';
import { performQueryAll } from './paginate';
import { resolveJourneyZone, rememberRecordZone, resolveRecordZone } from './journeyZones';
import { isSignedIn } from './publicAdapter';

const COMMENT_TYPE = 'DayComment';

/**
 * Query both databases. Failures are logged, not swallowed — an empty result that
 * means "the query was rejected" must not look like "there are no comments".
 */
async function queryComments(
    query: CloudKitJS.Query,
    options: CloudKitJS.QueryOptions = {}
): Promise<CloudKitJS.Record[]> {
    const [shared, priv] = await Promise.all([getSharedDatabase(), getPrivateDatabase()]);
    // Paginated: a well-used journey accumulates more comments than one page holds.
    const responses = await Promise.all([
        performQueryAll(shared, query, options).catch((err) => {
            console.warn('[cloudkit] shared comment query failed:', err);
            return [] as CloudKitJS.Record[];
        }),
        performQueryAll(priv, query, options).catch((err) => {
            console.warn('[cloudkit] private comment query failed:', err);
            return [] as CloudKitJS.Record[];
        }),
    ]);
    return responses.flat();
}

/**
 * Every comment in a journey's zone. Same reasoning as photos: callers hold the
 * slug, `journeyRef` holds a UUID reference, and one journey owns one zone (D3),
 * so scoping to the zone is both correct and cheaper than a predicate.
 */
async function queryCommentsInJourney(
    journeyId: string,
    sortBy?: CloudKitJS.Query['sortBy']
): Promise<CloudKitJS.Record[]> {
    const zone = await resolveJourneyZone(journeyId);
    if (!zone) {
        console.warn(`[cloudkit] no zone found for journey ${journeyId}`);
        return [];
    }
    const records = await queryComments({ recordType: COMMENT_TYPE, sortBy }, { zoneID: zone.zoneID });
    // Reading is how the write path learns which zone (and database) each comment
    // belongs to — edits and deletes are impossible without it.
    rememberRecordZone(records, zone);
    return records;
}

/**
 * Build a user-id -> author map from the share participants of every journey
 * referenced by the given comment records, plus the current signed-in user.
 */
async function buildAuthorsMap(comments: CloudKitJS.Record[]): Promise<Map<string, CommentAuthor>> {
    const authors = new Map<string, CommentAuthor>();

    // Include the signed-in user so their own comments show their name.
    const session = await getCloudKitSession().catch(() => ({ user: null }));
    if (session.user) {
        const profile = identityToProfile(session.user);
        authors.set(profile.id, {
            id: profile.id,
            display_name: profile.display_name ?? null,
            avatar_url: profile.avatar_url ?? null,
        });
    }

    // TODO(cloudkit): enrich remaining authors from each journey's participants.
    const journeyIds = new Set<string>();
    comments.forEach((c) => {
        const ref = c.fields?.journeyRef?.value as { recordName?: string } | string | undefined;
        const id = typeof ref === 'string' ? ref : ref?.recordName;
        if (id) journeyIds.add(id);
    });
    for (const journeyId of journeyIds) {
        const members = await getJourneyMembers(journeyId).catch(() => []);
        members.forEach((m) => {
            if (m.profile && !authors.has(m.user_id)) {
                authors.set(m.user_id, {
                    id: m.user_id,
                    display_name: m.profile.display_name ?? null,
                    avatar_url: m.profile.avatar_url ?? null,
                });
            }
        });
    }

    return authors;
}

export async function getCommentsForWaypoint(waypointId: string): Promise<DayComment[]> {
    // Comments live only in the private/shared DBs, which a signed-out visitor cannot
    // reach. Resolve to empty without querying (no console noise on the showcase).
    if (!(await isSignedIn())) return [];
    try {
        // The day's zone comes from the waypoint, remembered when the journey loaded.
        // Without it the query runs against the default zone and finds nothing —
        // including comments this very session just wrote.
        const zone = resolveRecordZone(waypointId);
        const records = await queryComments(
            {
                recordType: COMMENT_TYPE,
                filterBy: [
                    {
                        fieldName: 'waypointRef',
                        comparator: 'EQUALS',
                        fieldValue: {
                            value: { recordName: waypointId, zoneID: zone?.zoneID },
                            type: 'REFERENCE',
                        },
                    },
                ],
                sortBy: [{ fieldName: 'createdAt', ascending: true }],
            },
            zone ? { zoneID: zone.zoneID } : {}
        );
        if (zone) rememberRecordZone(records, zone);
        const authors = await buildAuthorsMap(records);
        return records
            .map((r) => recordToDayComment(r, authors))
            .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    } catch (err) {
        console.error('[cloudkit] Error fetching comments:', err);
        return [];
    }
}

export async function getCommentsForJourney(journeyId: string): Promise<DayComment[]> {
    if (!(await isSignedIn())) return [];
    try {
        const records = await queryCommentsInJourney(journeyId, [
            { fieldName: 'createdAt', ascending: false },
        ]);
        const authors = await buildAuthorsMap(records);
        return records
            .map((r) => recordToDayComment(r, authors))
            .sort((a, b) => (a.created_at > b.created_at ? -1 : a.created_at < b.created_at ? 1 : 0));
    } catch (err) {
        console.error('[cloudkit] Error fetching journey comments:', err);
        return [];
    }
}

export async function getCommentCountsForJourney(journeyId: string): Promise<Record<string, number>> {
    if (!(await isSignedIn())) return {};
    try {
        const records = await queryCommentsInJourney(journeyId);
        const counts: Record<string, number> = {};
        records.forEach((r) => {
            const wp = r.fields?.waypointRef?.value as { recordName?: string } | string | undefined;
            const waypointId = typeof wp === 'string' ? wp : wp?.recordName;
            if (waypointId) counts[waypointId] = (counts[waypointId] || 0) + 1;
        });
        return counts;
    } catch (err) {
        console.error('[cloudkit] Error fetching comment counts:', err);
        return {};
    }
}

export async function createComment(comment: NewDayComment): Promise<DayComment | null> {
    const session = await getCloudKitSession();
    const userId = session.user?.userRecordName;
    if (!userId) {
        throw new Error('Must be logged in to comment');
    }

    // A comment belongs in its journey's zone, in whichever database that zone lives.
    // Writing to the shared database with no zone put it nowhere and failed with
    // "zoneID needs to have ownerRecordName field for calls to sharedb".
    const zone = await resolveJourneyZone(comment.journey_id);
    if (!zone) throw new Error(`[cloudkit] unknown zone for journey ${comment.journey_id}`);

    try {
        const db = zone.scope === 'shared' ? await getSharedDatabase() : await getPrivateDatabase();
        const response = await db.saveRecords(
            [
                {
                    recordType: COMMENT_TYPE,
                    fields: {
                        // References must carry the zone too — a bare record name is
                        // ambiguous once records live outside the default zone.
                        waypointRef: {
                            value: {
                                recordName: comment.waypoint_id,
                                action: 'DELETE_SELF',
                                zoneID: zone.zoneID,
                            },
                        },
                        journeyRef: {
                            value: {
                                recordName: zone.recordName,
                                action: 'NONE',
                                zoneID: zone.zoneID,
                            },
                        },
                        content: { value: comment.content },
                    },
                },
            ],
            { zoneID: zone.zoneID }
        );
        if (response.hasErrors) {
            throw new Error(
                `[cloudkit] comment save rejected: ${response.errors?.[0]?.reason ?? 'unknown'}`
            );
        }
        const saved = response.records?.[0];
        if (!saved) return null;
        rememberRecordZone([saved], zone);
        const authors = await buildAuthorsMap([saved]);
        return recordToDayComment(saved, authors);
    } catch (err) {
        console.error('[cloudkit] Error creating comment:', err);
        throw err instanceof Error ? err : new Error(String(err));
    }
}

export async function updateComment(
    commentId: string,
    update: DayCommentUpdate
): Promise<DayComment | null> {
    const zone = resolveRecordZone(commentId);
    if (!zone) throw new Error(`[cloudkit] unknown zone for comment ${commentId} — load the day first`);

    try {
        const db = zone.scope === 'shared' ? await getSharedDatabase() : await getPrivateDatabase();
        // Without the current change tag the save is treated as an insert and
        // collides with the record it is trying to update.
        const existing = await db.fetchRecords(commentId, { zoneID: zone.zoneID });
        const response = await db.saveRecords(
            [
                {
                    recordType: COMMENT_TYPE,
                    recordName: commentId,
                    recordChangeTag: existing.records?.[0]?.recordChangeTag,
                    fields: { content: { value: update.content } },
                },
            ],
            { zoneID: zone.zoneID }
        );
        if (response.hasErrors) {
            throw new Error(
                `[cloudkit] comment update rejected: ${response.errors?.[0]?.reason ?? 'unknown'}`
            );
        }
        const saved = response.records?.[0];
        if (!saved) return null;
        const authors = await buildAuthorsMap([saved]);
        return recordToDayComment(saved, authors);
    } catch (err) {
        console.error('[cloudkit] Error updating comment:', err);
        throw err instanceof Error ? err : new Error(String(err));
    }
}

export async function deleteComment(commentId: string): Promise<boolean> {
    const zone = resolveRecordZone(commentId);
    if (!zone) throw new Error(`[cloudkit] unknown zone for comment ${commentId} — load the day first`);

    try {
        const db = zone.scope === 'shared' ? await getSharedDatabase() : await getPrivateDatabase();
        const response = await db.deleteRecords([{ recordName: commentId }], {
            zoneID: zone.zoneID,
        });
        if (response.hasErrors) {
            throw new Error(
                `[cloudkit] comment delete rejected: ${response.errors?.[0]?.reason ?? 'unknown'}`
            );
        }
        return true;
    } catch (err) {
        console.error('[cloudkit] Error deleting comment:', err);
        throw err instanceof Error ? err : new Error(String(err));
    }
}

export async function canUserComment(journeyId: string): Promise<boolean> {
    try {
        const session = await getCloudKitSession();
        if (!session.user) return false;
        // A signed-in participant of a shared journey can always comment; the
        // public-mirror case is governed natively by the publish step.
        const members = await getJourneyMembers(journeyId);
        return members.some((m) => m.user_id === session.user?.userRecordName);
    } catch (err) {
        console.error('[cloudkit] Error checking comment permission:', err);
        return false;
    }
}

export async function getCurrentUserId(): Promise<string | null> {
    try {
        const session = await getCloudKitSession();
        return session.user?.userRecordName ?? null;
    } catch {
        return null;
    }
}
