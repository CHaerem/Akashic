/**
 * Day Comments Section
 * Container component that combines comment list and input
 */

import { memo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, radius, gradients } from '../../styles/liquidGlass';
import { CommentIcon } from '../icons';
import { CommentItem } from './CommentItem';
import { CommentInput } from './CommentInput';
import {
    getCommentsForWaypoint,
    createComment,
    updateComment,
    deleteComment,
    getCurrentUserId,
    canUserComment,
} from '../../lib/journeys';
import type { DayComment } from '../../lib/journeys/types';
import type { Camp } from '../../types/trek';

interface DayCommentsSectionProps {
    camp: Camp;
    journeyId: string;
}

export const DayCommentsSection = memo(function DayCommentsSection({
    camp,
    journeyId,
}: DayCommentsSectionProps) {
    const [comments, setComments] = useState<DayComment[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [canComment, setCanComment] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    // Fetch comments and user info
    useEffect(() => {
        let cancelled = false;

        async function loadData() {
            setLoading(true);
            try {
                const [commentsData, userId, hasPermission] = await Promise.all([
                    getCommentsForWaypoint(camp.id),
                    getCurrentUserId(),
                    canUserComment(journeyId),
                ]);

                if (!cancelled) {
                    setComments(commentsData);
                    setCurrentUserId(userId);
                    setCanComment(hasPermission);
                }
            } catch (error) {
                console.error('Failed to load comments:', error);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        loadData();

        return () => {
            cancelled = true;
        };
    }, [camp.id, journeyId]);

    const handleAddComment = useCallback(async (content: string) => {
        const newComment = await createComment({
            waypoint_id: camp.id,
            journey_id: journeyId,
            content,
        });

        if (newComment) {
            setComments(prev => [...prev, newComment]);
        }
    }, [camp.id, journeyId]);

    const handleUpdateComment = useCallback(async (commentId: string, content: string) => {
        const updated = await updateComment(commentId, { content });

        if (updated) {
            setComments(prev =>
                prev.map(c => (c.id === commentId ? updated : c))
            );
        }
    }, []);

    const handleDeleteComment = useCallback(async (commentId: string) => {
        await deleteComment(commentId);
        setComments(prev => prev.filter(c => c.id !== commentId));
    }, []);

    const commentCount = comments.length;

    return (
        <div
            style={{
                background: gradients.glass.subtle,
                borderRadius: radius.lg,
                border: `1px solid ${colors.glass.borderSubtle}`,
                overflow: 'hidden',
            }}
        >
            {/* Header - always visible */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 12,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: colors.text.primary,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CommentIcon size={16} />
                    <span style={{ fontSize: 14, fontWeight: 500 }}>
                        Comments
                    </span>
                    {commentCount > 0 && (
                        <span
                            style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: colors.accent.primary,
                                background: 'rgba(96, 165, 250, 0.15)',
                                padding: '2px 6px',
                                borderRadius: radius.xs,
                            }}
                        >
                            {commentCount}
                        </span>
                    )}
                </div>
                <motion.div
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ color: colors.text.tertiary }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                </motion.div>
            </button>

            {/* Expandable content */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div
                            style={{
                                padding: '0 12px 12px 12px',
                                borderTop: `1px solid ${colors.glass.borderSubtle}`,
                            }}
                        >
                            {/* Loading state */}
                            {loading && (
                                <div
                                    style={{
                                        padding: 20,
                                        textAlign: 'center',
                                        color: colors.text.tertiary,
                                    }}
                                >
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                                        style={{
                                            width: 20,
                                            height: 20,
                                            border: `2px solid ${colors.glass.border}`,
                                            borderTopColor: colors.accent.primary,
                                            borderRadius: '50%',
                                            margin: '0 auto',
                                        }}
                                    />
                                </div>
                            )}

                            {/* Comments list */}
                            {!loading && (
                                <div style={{ marginTop: 12 }}>
                                    {comments.length === 0 ? (
                                        <p
                                            style={{
                                                fontSize: 13,
                                                color: colors.text.tertiary,
                                                textAlign: 'center',
                                                margin: '16px 0',
                                            }}
                                        >
                                            No comments yet. Be the first to share your thoughts!
                                        </p>
                                    ) : (
                                        <div
                                            style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 8,
                                                marginBottom: 12,
                                                maxHeight: 300,
                                                overflowY: 'auto',
                                            }}
                                        >
                                            <AnimatePresence mode="popLayout">
                                                {comments.map(comment => (
                                                    <CommentItem
                                                        key={comment.id}
                                                        comment={comment}
                                                        currentUserId={currentUserId}
                                                        onUpdate={handleUpdateComment}
                                                        onDelete={handleDeleteComment}
                                                    />
                                                ))}
                                            </AnimatePresence>
                                        </div>
                                    )}

                                    {/* Comment input */}
                                    <CommentInput
                                        onSubmit={handleAddComment}
                                        disabled={!canComment}
                                        placeholder={`Comment on Day ${camp.dayNumber}...`}
                                    />
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

export default DayCommentsSection;
