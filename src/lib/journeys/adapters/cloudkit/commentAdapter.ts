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

const COMMENT_TYPE = 'DayComment';

async function queryComments(query: CloudKitJS.Query): Promise<CloudKitJS.Record[]> {
    const [shared, priv] = await Promise.all([getSharedDatabase(), getPrivateDatabase()]);
    // Paginated: a well-used journey accumulates more comments than one page holds.
    const responses = await Promise.all([
        performQueryAll(shared, query).catch(() => [] as CloudKitJS.Record[]),
        performQueryAll(priv, query).catch(() => [] as CloudKitJS.Record[]),
    ]);
    return responses.flat();
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
    try {
        const records = await queryComments({
            recordType: COMMENT_TYPE,
            filterBy: [
                { fieldName: 'waypointRef', comparator: 'EQUALS', fieldValue: { value: waypointId } },
            ],
            sortBy: [{ fieldName: 'createdAt', ascending: true }],
        });
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
    try {
        const records = await queryComments({
            recordType: COMMENT_TYPE,
            filterBy: [
                { fieldName: 'journeyRef', comparator: 'EQUALS', fieldValue: { value: journeyId } },
            ],
            sortBy: [{ fieldName: 'createdAt', ascending: false }],
        });
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
    try {
        const records = await queryComments({
            recordType: COMMENT_TYPE,
            filterBy: [
                { fieldName: 'journeyRef', comparator: 'EQUALS', fieldValue: { value: journeyId } },
            ],
        });
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

    try {
        // TODO(cloudkit): choose the correct writable database (shared vs private)
        // for the target journey's zone.
        const db = await getSharedDatabase();
        const response = await db.saveRecords({
            recordType: COMMENT_TYPE,
            fields: {
                waypointRef: { value: { recordName: comment.waypoint_id, action: 'DELETE_SELF' } },
                journeyRef: { value: { recordName: comment.journey_id, action: 'DELETE_SELF' } },
                content: { value: comment.content },
            },
        });
        const saved = response.records?.[0];
        if (!saved) return null;
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
    try {
        const db = await getSharedDatabase();
        // TODO(cloudkit): supply recordChangeTag and resolve the home database.
        const response = await db.saveRecords({
            recordType: COMMENT_TYPE,
            recordName: commentId,
            fields: { content: { value: update.content } },
        });
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
    try {
        const db = await getSharedDatabase();
        await db.deleteRecords(commentId);
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
