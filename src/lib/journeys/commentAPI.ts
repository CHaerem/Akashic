/**
 * Day Comment CRUD operations
 */

import { supabase } from '../supabase';
import type { DayComment, NewDayComment, DayCommentUpdate, CommentAuthor } from './types';

/**
 * Default author when profile is not available
 */
const DEFAULT_AUTHOR: CommentAuthor = {
    id: '',
    display_name: null,
    avatar_url: null,
};

/**
 * Fetch comments for a waypoint/day
 * Includes author profile info
 */
export async function getCommentsForWaypoint(waypointId: string): Promise<DayComment[]> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('day_comments')
        .select(`
            *,
            author:profiles!user_id(id, display_name, avatar_url)
        `)
        .eq('waypoint_id', waypointId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching comments:', error);
        return [];
    }

    return (data || []).map(comment => ({
        ...comment,
        author: comment.author || { ...DEFAULT_AUTHOR, id: comment.user_id },
    }));
}

/**
 * Fetch all comments for a journey (for overview/stats)
 */
export async function getCommentsForJourney(journeyId: string): Promise<DayComment[]> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('day_comments')
        .select(`
            *,
            author:profiles!user_id(id, display_name, avatar_url)
        `)
        .eq('journey_id', journeyId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching journey comments:', error);
        return [];
    }

    return (data || []).map(comment => ({
        ...comment,
        author: comment.author || { ...DEFAULT_AUTHOR, id: comment.user_id },
    }));
}

/**
 * Get comment count per waypoint for a journey
 */
export async function getCommentCountsForJourney(
    journeyId: string
): Promise<Record<string, number>> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return {};
    }

    const { data, error } = await supabase
        .from('day_comments')
        .select('waypoint_id')
        .eq('journey_id', journeyId);

    if (error) {
        console.error('Error fetching comment counts:', error);
        return {};
    }

    const counts: Record<string, number> = {};
    (data || []).forEach(row => {
        counts[row.waypoint_id] = (counts[row.waypoint_id] || 0) + 1;
    });

    return counts;
}

/**
 * Create a new comment
 */
export async function createComment(comment: NewDayComment): Promise<DayComment | null> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        throw new Error('Must be logged in to comment');
    }

    const { data, error } = await supabase
        .from('day_comments')
        .insert({
            ...comment,
            user_id: user.id,
        })
        .select(`
            *,
            author:profiles!user_id(id, display_name, avatar_url)
        `)
        .single();

    if (error) {
        console.error('Error creating comment:', error);
        throw new Error(error.message);
    }

    return {
        ...data,
        author: data.author || { ...DEFAULT_AUTHOR, id: data.user_id },
    };
}

/**
 * Update a comment (author only)
 */
export async function updateComment(
    commentId: string,
    update: DayCommentUpdate
): Promise<DayComment | null> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    const { data, error } = await supabase
        .from('day_comments')
        .update(update)
        .eq('id', commentId)
        .select(`
            *,
            author:profiles!user_id(id, display_name, avatar_url)
        `)
        .single();

    if (error) {
        console.error('Error updating comment:', error);
        throw new Error(error.message);
    }

    return {
        ...data,
        author: data.author || { ...DEFAULT_AUTHOR, id: data.user_id },
    };
}

/**
 * Delete a comment
 */
export async function deleteComment(commentId: string): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('day_comments')
        .delete()
        .eq('id', commentId);

    if (error) {
        console.error('Error deleting comment:', error);
        throw new Error(error.message);
    }

    return true;
}

/**
 * Check if current user can comment on a journey
 */
export async function canUserComment(journeyId: string): Promise<boolean> {
    if (!supabase) return false;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    // Check if journey is public
    const { data: journey } = await supabase
        .from('journeys')
        .select('is_public')
        .eq('id', journeyId)
        .single();

    if (journey?.is_public) return true;

    // Check if user is a member
    const { data: member } = await supabase
        .from('journey_members')
        .select('role')
        .eq('journey_id', journeyId)
        .eq('user_id', user.id)
        .single();

    return !!member;
}

/**
 * Get current user's ID (helper for checking comment ownership)
 */
export async function getCurrentUserId(): Promise<string | null> {
    if (!supabase) return null;

    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}
