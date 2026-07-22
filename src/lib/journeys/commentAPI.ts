/**
 * Day comments.
 *
 * CloudKit is the only backend now (T3.4). This module stays as the stable import
 * surface the components use, so nothing outside `adapters/` knows which store sits
 * underneath.
 */

export {
    getCommentsForWaypoint,
    getCommentsForJourney,
    getCommentCountsForJourney,
    createComment,
    updateComment,
    deleteComment,
    canUserComment,
    getCurrentUserId,
} from './adapters/cloudkit/commentAdapter';
