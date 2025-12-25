/**
 * Comment Item component
 * Displays a single comment with author info and edit/delete actions
 */

import { memo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, radius, glassInput, glassInputFocus, transitions } from '../../styles/liquidGlass';
import { PencilIcon, TrashIcon } from '../icons';
import type { DayComment } from '../../lib/journeys/types';

interface CommentItemProps {
    comment: DayComment;
    currentUserId: string | null;
    onUpdate: (commentId: string, content: string) => Promise<void>;
    onDelete: (commentId: string) => Promise<void>;
}

/**
 * Format relative time (e.g., "2h ago", "3 days ago")
 */
function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 30) {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    if (diffDay > 0) return `${diffDay}d ago`;
    if (diffHour > 0) return `${diffHour}h ago`;
    if (diffMin > 0) return `${diffMin}m ago`;
    return 'just now';
}

export const CommentItem = memo(function CommentItem({
    comment,
    currentUserId,
    onUpdate,
    onDelete,
}: CommentItemProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(comment.content);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const isOwner = currentUserId === comment.user_id;
    const wasEdited = comment.updated_at !== comment.created_at;

    const handleEdit = useCallback(() => {
        setEditContent(comment.content);
        setIsEditing(true);
    }, [comment.content]);

    const handleCancelEdit = useCallback(() => {
        setIsEditing(false);
        setEditContent(comment.content);
    }, [comment.content]);

    const handleSaveEdit = useCallback(async () => {
        if (!editContent.trim() || editContent === comment.content) {
            handleCancelEdit();
            return;
        }
        setIsSaving(true);
        try {
            await onUpdate(comment.id, editContent.trim());
            setIsEditing(false);
        } catch (error) {
            console.error('Failed to update comment:', error);
        } finally {
            setIsSaving(false);
        }
    }, [comment.id, comment.content, editContent, onUpdate, handleCancelEdit]);

    const handleDelete = useCallback(async () => {
        if (!isDeleting) {
            setIsDeleting(true);
            return;
        }
        try {
            await onDelete(comment.id);
        } catch (error) {
            console.error('Failed to delete comment:', error);
            setIsDeleting(false);
        }
    }, [comment.id, isDeleting, onDelete]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSaveEdit();
        } else if (e.key === 'Escape') {
            handleCancelEdit();
        }
    }, [handleSaveEdit, handleCancelEdit]);

    const authorInitial = (comment.author.display_name || 'U')[0].toUpperCase();

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            style={{
                display: 'flex',
                gap: 10,
                padding: 10,
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: radius.md,
                border: `1px solid ${colors.glass.borderSubtle}`,
            }}
        >
            {/* Avatar */}
            <div
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: colors.glass.medium,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                {comment.author.avatar_url ? (
                    <img
                        src={comment.author.avatar_url}
                        alt={comment.author.display_name || 'User'}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }}
                    />
                ) : (
                    <span style={{ fontSize: 14, color: colors.text.secondary }}>
                        {authorInitial}
                    </span>
                )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
                {/* Header */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 4,
                    }}
                >
                    <span style={{ fontSize: 13, fontWeight: 500, color: colors.text.primary }}>
                        {comment.author.display_name || 'Anonymous'}
                    </span>
                    <span style={{ fontSize: 11, color: colors.text.tertiary }}>
                        {formatRelativeTime(comment.created_at)}
                    </span>
                    {wasEdited && (
                        <span style={{ fontSize: 11, color: colors.text.subtle, fontStyle: 'italic' }}>
                            (edited)
                        </span>
                    )}
                </div>

                {/* Comment content or edit form */}
                <AnimatePresence mode="wait">
                    {isEditing ? (
                        <motion.div
                            key="edit"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                onKeyDown={handleKeyDown}
                                maxLength={2000}
                                autoFocus
                                style={{
                                    ...glassInput,
                                    width: '100%',
                                    minHeight: 60,
                                    padding: 8,
                                    fontSize: 13,
                                    color: colors.text.primary,
                                    borderRadius: radius.sm,
                                    resize: 'vertical',
                                    outline: 'none',
                                }}
                                onFocus={(e) => {
                                    Object.assign(e.target.style, glassInputFocus);
                                }}
                                onBlur={(e) => {
                                    Object.assign(e.target.style, {
                                        border: glassInput.border,
                                        boxShadow: glassInput.boxShadow,
                                    });
                                }}
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                <button
                                    onClick={handleSaveEdit}
                                    disabled={isSaving || !editContent.trim()}
                                    style={{
                                        padding: '6px 12px',
                                        fontSize: 12,
                                        fontWeight: 500,
                                        background: 'rgba(96, 165, 250, 0.2)',
                                        color: colors.accent.primary,
                                        border: 'none',
                                        borderRadius: radius.sm,
                                        cursor: isSaving ? 'wait' : 'pointer',
                                        opacity: isSaving || !editContent.trim() ? 0.5 : 1,
                                    }}
                                >
                                    {isSaving ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                    onClick={handleCancelEdit}
                                    disabled={isSaving}
                                    style={{
                                        padding: '6px 12px',
                                        fontSize: 12,
                                        fontWeight: 500,
                                        background: 'transparent',
                                        color: colors.text.tertiary,
                                        border: 'none',
                                        borderRadius: radius.sm,
                                        cursor: 'pointer',
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.p
                            key="content"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            style={{
                                fontSize: 13,
                                lineHeight: 1.5,
                                color: colors.text.secondary,
                                margin: 0,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}
                        >
                            {comment.content}
                        </motion.p>
                    )}
                </AnimatePresence>

                {/* Delete confirmation */}
                <AnimatePresence>
                    {isDeleting && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            style={{
                                marginTop: 8,
                                padding: 8,
                                background: 'rgba(239, 68, 68, 0.1)',
                                borderRadius: radius.sm,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                            }}
                        >
                            <span style={{ fontSize: 12, color: colors.accent.error }}>
                                Delete this comment?
                            </span>
                            <button
                                onClick={handleDelete}
                                style={{
                                    padding: '4px 8px',
                                    fontSize: 11,
                                    fontWeight: 500,
                                    background: 'rgba(239, 68, 68, 0.2)',
                                    color: colors.accent.error,
                                    border: 'none',
                                    borderRadius: radius.xs,
                                    cursor: 'pointer',
                                }}
                            >
                                Delete
                            </button>
                            <button
                                onClick={() => setIsDeleting(false)}
                                style={{
                                    padding: '4px 8px',
                                    fontSize: 11,
                                    fontWeight: 500,
                                    background: 'transparent',
                                    color: colors.text.tertiary,
                                    border: 'none',
                                    borderRadius: radius.xs,
                                    cursor: 'pointer',
                                }}
                            >
                                Cancel
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Actions (only for comment owner) */}
            {isOwner && !isEditing && !isDeleting && (
                <div
                    style={{
                        display: 'flex',
                        gap: 4,
                        opacity: 0.6,
                        transition: `opacity ${transitions.fast}`,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
                >
                    <button
                        onClick={handleEdit}
                        title="Edit comment"
                        style={{
                            padding: 4,
                            background: 'transparent',
                            border: 'none',
                            borderRadius: radius.xs,
                            cursor: 'pointer',
                            color: colors.text.tertiary,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <PencilIcon size={14} />
                    </button>
                    <button
                        onClick={handleDelete}
                        title="Delete comment"
                        style={{
                            padding: 4,
                            background: 'transparent',
                            border: 'none',
                            borderRadius: radius.xs,
                            cursor: 'pointer',
                            color: colors.text.tertiary,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <TrashIcon size={14} />
                    </button>
                </div>
            )}
        </motion.div>
    );
});

export default CommentItem;
