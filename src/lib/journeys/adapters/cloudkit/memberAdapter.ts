/**
 * CloudKit adapter — member reads from CKShare participants.
 *
 * The participant list of a journey's share is read-only on web; inviting,
 * removing and role changes are native-only. `userHasRole` in memberAPI keeps
 * working automatically because it composes `getUserJourneyRole`, which is
 * dispatched here.
 */

import type { Profile, JourneyMember, JourneyRole } from '../../../../types/trek';
import { getSharedDatabase, getPrivateDatabase, getCloudKitSession } from '../../../cloudkit';
import { participantToMember } from './records';
import { CK_UNSUPPORTED } from './journeyAdapter';

/**
 * List the members of a journey by reading its CKShare participants and mapping
 * each to a JourneyMember (with a profile synthesized from the participant's
 * identity — CloudKit has no server-side profile join).
 */
export async function getJourneyMembers(journeyId: string): Promise<JourneyMember[]> {
    try {
        // TODO(cloudkit): resolve the journey's CKShare and read its participants.
        // The share record name is derived from the Journey record's `share`
        // reference; fetching it yields `participants` on the share record.
        const [shared, priv] = await Promise.all([getSharedDatabase(), getPrivateDatabase()]);
        const responses = await Promise.all([
            shared.fetchRecords(journeyId).catch(() => ({ records: [] as CloudKitJS.Record[] })),
            priv.fetchRecords(journeyId).catch(() => ({ records: [] as CloudKitJS.Record[] })),
        ]);
        const record = responses.flatMap((r) => r.records ?? [])[0] as
            | (CloudKitJS.Record & { participants?: CloudKitJS.ShareParticipant[] })
            | undefined;
        const participants = record?.participants ?? [];
        return participants.map((p) => participantToMember(p, journeyId));
    } catch (err) {
        console.error('[cloudkit] Error fetching journey members:', err);
        return [];
    }
}

/** The current user's role in a journey (derived from the participant list). */
export async function getUserJourneyRole(journeyId: string): Promise<JourneyRole | null> {
    try {
        const session = await getCloudKitSession();
        const userId = session.user?.userRecordName;
        if (!userId) return null;
        const members = await getJourneyMembers(journeyId);
        return members.find((m) => m.user_id === userId)?.role ?? null;
    } catch (err) {
        console.error('[cloudkit] Error resolving user role:', err);
        return null;
    }
}

// --- Native-only writes -----------------------------------------------------

export async function getRegisteredUsers(): Promise<Profile[]> {
    console.warn(CK_UNSUPPORTED);
    return [];
}

export async function addJourneyMember(
    _journeyId: string,
    _userId: string,
    _role: JourneyRole
): Promise<JourneyMember | null> {
    console.warn(CK_UNSUPPORTED);
    return null;
}

export async function removeJourneyMember(_journeyId: string, _userId: string): Promise<boolean> {
    console.warn(CK_UNSUPPORTED);
    return false;
}

export async function updateMemberRole(
    _journeyId: string,
    _userId: string,
    _newRole: JourneyRole
): Promise<boolean> {
    console.warn(CK_UNSUPPORTED);
    return false;
}
