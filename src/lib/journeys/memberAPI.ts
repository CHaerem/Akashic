/**
 * Journey membership.
 *
 * Under CloudKit these are CKShare participants, not rows in a members table — the
 * adapter maps between the two. Sending invitations is native-only
 * (`UICloudSharingController`), so the write paths are guarded no-ops on web.
 */

import type { JourneyRole } from '../../types/trek';
import { getUserJourneyRole } from './adapters/cloudkit/memberAdapter';

export {
    getJourneyMembers,
    getRegisteredUsers,
    addJourneyMember,
    removeJourneyMember,
    updateMemberRole,
    getUserJourneyRole,
} from './adapters/cloudkit/memberAdapter';

/** Does the signed-in user hold at least `requiredRole` on this journey? */
export async function userHasRole(journeyId: string, requiredRole: JourneyRole): Promise<boolean> {
    const userRole = await getUserJourneyRole(journeyId);
    if (!userRole) return false;

    const roleHierarchy: Record<JourneyRole, number> = {
        viewer: 1,
        editor: 2,
        owner: 3,
    };

    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}
