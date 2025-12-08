/**
 * Journey member management functions
 */

import { supabase } from '../supabase';
import type { Profile, JourneyMember, JourneyRole } from '../../types/trek';

/**
 * Get all members of a journey with their profiles
 */
export async function getJourneyMembers(journeyId: string): Promise<JourneyMember[]> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('journey_members')
        .select(`
            *,
            profile:profiles(*)
        `)
        .eq('journey_id', journeyId)
        .order('created_at');

    if (error) {
        console.error('Error fetching journey members:', error);
        return [];
    }

    return data || [];
}

/**
 * Get all registered users (for invite dropdown)
 */
export async function getRegisteredUsers(): Promise<Profile[]> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('display_name');

    if (error) {
        console.error('Error fetching profiles:', error);
        return [];
    }

    return data || [];
}

/**
 * Add a member to a journey (owner only)
 */
export async function addJourneyMember(
    journeyId: string,
    userId: string,
    role: JourneyRole
): Promise<JourneyMember | null> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    // Get current user to set as inviter
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
        .from('journey_members')
        .insert({
            journey_id: journeyId,
            user_id: userId,
            role,
            invited_by: user?.id
        })
        .select(`
            *,
            profile:profiles(*)
        `)
        .single();

    if (error) {
        console.error('Error adding journey member:', error);
        throw new Error(error.message);
    }

    return data;
}

/**
 * Remove a member from a journey (owner only, or self-remove)
 */
export async function removeJourneyMember(journeyId: string, userId: string): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('journey_members')
        .delete()
        .eq('journey_id', journeyId)
        .eq('user_id', userId);

    if (error) {
        console.error('Error removing journey member:', error);
        throw new Error(error.message);
    }

    return true;
}

/**
 * Update a member's role (owner only)
 */
export async function updateMemberRole(
    journeyId: string,
    userId: string,
    newRole: JourneyRole
): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('journey_members')
        .update({ role: newRole })
        .eq('journey_id', journeyId)
        .eq('user_id', userId);

    if (error) {
        console.error('Error updating member role:', error);
        throw new Error(error.message);
    }

    return true;
}

/**
 * Get current user's role in a journey
 */
export async function getUserJourneyRole(journeyId: string): Promise<JourneyRole | null> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
        .from('journey_members')
        .select('role')
        .eq('journey_id', journeyId)
        .eq('user_id', user.id)
        .single();

    if (error) {
        // User is not a member
        return null;
    }

    return data?.role as JourneyRole || null;
}

/**
 * Check if current user has at least the required role for a journey
 */
export async function userHasRole(journeyId: string, requiredRole: JourneyRole): Promise<boolean> {
    const userRole = await getUserJourneyRole(journeyId);
    if (!userRole) return false;

    const roleHierarchy: Record<JourneyRole, number> = {
        'viewer': 1,
        'editor': 2,
        'owner': 3
    };

    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}
