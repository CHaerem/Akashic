import { memo, useState, useEffect, useCallback } from 'react';
import {
    getJourneyForEdit,
    updateJourney,
    getJourneyMembers,
    getRegisteredUsers,
    addJourneyMember,
    removeJourneyMember,
    updateMemberRole,
    getUserJourneyRole,
    type DbJourney,
    type JourneyUpdate
} from '../../lib/journeys';
import type { JourneyMember, Profile, JourneyRole } from '../../types/trek';
import { GlassModal, glassInputStyle, glassLabelStyle, glassInfoBoxStyle, glassErrorBoxStyle } from '../common/GlassModal';
import { GlassButton } from '../common/GlassButton';
import { colors, transitions, radius } from '../../styles/liquidGlass';

interface JourneyEditModalProps {
    slug: string;
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    isMobile: boolean;
}

// Enhanced input with focus state handling
function GlassInput({
    type = 'text',
    value,
    onChange,
    placeholder,
    style,
    ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { style?: React.CSSProperties }) {
    const [focused, setFocused] = useState(false);

    return (
        <input
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
                ...glassInputStyle,
                ...(focused && {
                    borderColor: colors.accent.primary,
                    boxShadow: `
                        inset 0 2px 4px rgba(0, 0, 0, 0.2),
                        0 0 0 3px rgba(96, 165, 250, 0.2)
                    `,
                }),
                ...style,
            }}
            {...props}
        />
    );
}

// Enhanced textarea with focus state handling
function GlassTextarea({
    value,
    onChange,
    placeholder,
    style,
    ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { style?: React.CSSProperties }) {
    const [focused, setFocused] = useState(false);

    return (
        <textarea
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
                ...glassInputStyle,
                minHeight: 100,
                resize: 'vertical' as const,
                ...(focused && {
                    borderColor: colors.accent.primary,
                    boxShadow: `
                        inset 0 2px 4px rgba(0, 0, 0, 0.2),
                        0 0 0 3px rgba(96, 165, 250, 0.2)
                    `,
                }),
                ...style,
            }}
            {...props}
        />
    );
}

export const JourneyEditModal = memo(function JourneyEditModal({
    slug,
    isOpen,
    onClose,
    onSave,
    isMobile
}: JourneyEditModalProps) {
    const [journey, setJourney] = useState<DbJourney | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [country, setCountry] = useState('');
    const [dateStarted, setDateStarted] = useState('');
    const [dateEnded, setDateEnded] = useState('');
    const [totalDays, setTotalDays] = useState('');
    const [totalDistance, setTotalDistance] = useState('');
    const [summitElevation, setSummitElevation] = useState('');

    // Member management state
    const [members, setMembers] = useState<JourneyMember[]>([]);
    const [registeredUsers, setRegisteredUsers] = useState<Profile[]>([]);
    const [userRole, setUserRole] = useState<JourneyRole | null>(null);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [selectedRole, setSelectedRole] = useState<JourneyRole>('editor');
    const [addingMember, setAddingMember] = useState(false);
    const [memberError, setMemberError] = useState<string | null>(null);

    // Load journey data
    useEffect(() => {
        if (!isOpen || !slug) return;

        setLoading(true);
        setError(null);
        setMemberError(null);

        getJourneyForEdit(slug).then(async data => {
            if (data) {
                setJourney(data);
                setName(data.name || '');
                setDescription(data.description || '');
                setCountry(data.country || '');
                setDateStarted(data.date_started || '');
                setDateEnded(data.date_ended || '');
                setTotalDays(data.total_days?.toString() || '');
                setTotalDistance(data.total_distance?.toString() || '');
                setSummitElevation(data.summit_elevation?.toString() || '');

                // Load members and user role using journey UUID
                const [membersData, role, users] = await Promise.all([
                    getJourneyMembers(data.id),
                    getUserJourneyRole(data.id),
                    getRegisteredUsers()
                ]);
                setMembers(membersData);
                setUserRole(role);
                setRegisteredUsers(users);
            }
            setLoading(false);
        }).catch(err => {
            setError(err.message);
            setLoading(false);
        });
    }, [isOpen, slug]);

    const handleSave = useCallback(async () => {
        if (!journey) return;

        setSaving(true);
        setError(null);

        try {
            const updates: JourneyUpdate = {
                name: name || journey.name,
                description: description || null,
                country: country || null,
                date_started: dateStarted || null,
                date_ended: dateEnded || null,
                total_days: totalDays ? parseInt(totalDays, 10) : null,
                total_distance: totalDistance ? parseFloat(totalDistance) : null,
                summit_elevation: summitElevation ? parseInt(summitElevation, 10) : null
            };

            await updateJourney(slug, updates);
            onSave();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    }, [journey, slug, name, description, country, dateStarted, dateEnded, totalDays, totalDistance, summitElevation, onSave, onClose]);

    // Member management handlers
    const handleAddMember = useCallback(async () => {
        if (!journey || !selectedUserId) return;

        setAddingMember(true);
        setMemberError(null);

        try {
            const newMember = await addJourneyMember(journey.id, selectedUserId, selectedRole);
            if (newMember) {
                setMembers(prev => [...prev, newMember]);
            }
            setSelectedUserId('');
        } catch (err) {
            setMemberError(err instanceof Error ? err.message : 'Failed to add member');
        } finally {
            setAddingMember(false);
        }
    }, [journey, selectedUserId, selectedRole]);

    const handleRemoveMember = useCallback(async (userId: string) => {
        if (!journey) return;

        try {
            await removeJourneyMember(journey.id, userId);
            setMembers(prev => prev.filter(m => m.user_id !== userId));
        } catch (err) {
            setMemberError(err instanceof Error ? err.message : 'Failed to remove member');
        }
    }, [journey]);

    const handleRoleChange = useCallback(async (userId: string, newRole: JourneyRole) => {
        if (!journey) return;

        try {
            await updateMemberRole(journey.id, userId, newRole);
            setMembers(prev => prev.map(m =>
                m.user_id === userId ? { ...m, role: newRole } : m
            ));
        } catch (err) {
            setMemberError(err instanceof Error ? err.message : 'Failed to update role');
        }
    }, [journey]);

    // Filter out users who are already members
    const availableUsers = registeredUsers.filter(
        user => !members.some(m => m.user_id === user.id)
    );

    const isOwner = userRole === 'owner';

    const footer = (
        <>
            <GlassButton variant="subtle" size="md" onClick={onClose}>
                Cancel
            </GlassButton>
            <GlassButton
                variant="primary"
                size="md"
                onClick={handleSave}
                disabled={saving || loading}
                style={{ opacity: saving || loading ? 0.5 : 1 }}
            >
                {saving ? 'Saving...' : 'Save Changes'}
            </GlassButton>
        </>
    );

    return (
        <GlassModal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit Journey"
            footer={footer}
            isMobile={isMobile}
        >
            {loading ? (
                <div style={{ color: colors.text.tertiary, textAlign: 'center', padding: 40 }}>
                    Loading...
                </div>
            ) : error ? (
                <div style={glassErrorBoxStyle}>
                    {error}
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Name */}
                    <div>
                        <label style={glassLabelStyle}>Name</label>
                        <GlassInput
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Journey name"
                        />
                    </div>

                    {/* Country */}
                    <div>
                        <label style={glassLabelStyle}>Country</label>
                        <GlassInput
                            type="text"
                            value={country}
                            onChange={e => setCountry(e.target.value)}
                            placeholder="e.g., Peru"
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label style={glassLabelStyle}>Description</label>
                        <GlassTextarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Journey description..."
                        />
                    </div>

                    {/* Dates */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                            <label style={glassLabelStyle}>Start Date</label>
                            <GlassInput
                                type="date"
                                value={dateStarted}
                                onChange={e => setDateStarted(e.target.value)}
                                style={{ colorScheme: 'dark' }}
                            />
                        </div>
                        <div>
                            <label style={glassLabelStyle}>End Date</label>
                            <GlassInput
                                type="date"
                                value={dateEnded}
                                onChange={e => setDateEnded(e.target.value)}
                                style={{ colorScheme: 'dark' }}
                            />
                        </div>
                    </div>

                    {/* Stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        <div>
                            <label style={glassLabelStyle}>Days</label>
                            <GlassInput
                                type="number"
                                value={totalDays}
                                onChange={e => setTotalDays(e.target.value)}
                                placeholder="e.g., 5"
                                min={1}
                            />
                        </div>
                        <div>
                            <label style={glassLabelStyle}>Distance (km)</label>
                            <GlassInput
                                type="number"
                                value={totalDistance}
                                onChange={e => setTotalDistance(e.target.value)}
                                placeholder="e.g., 45"
                                step={0.1}
                            />
                        </div>
                        <div>
                            <label style={glassLabelStyle}>Summit (m)</label>
                            <GlassInput
                                type="number"
                                value={summitElevation}
                                onChange={e => setSummitElevation(e.target.value)}
                                placeholder="e.g., 4215"
                            />
                        </div>
                    </div>

                    {/* Info about date matching */}
                    {dateStarted && (
                        <div style={glassInfoBoxStyle}>
                            Photos will be matched to days based on this start date.
                            Day 1 = {new Date(dateStarted).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                    )}

                    {/* Members Section */}
                    <div style={{
                        marginTop: 24,
                        paddingTop: 24,
                        borderTop: `1px solid ${colors.glass.borderSubtle}`
                    }}>
                        <label style={{
                            ...glassLabelStyle,
                            fontSize: 14,
                            marginBottom: 16,
                            display: 'block'
                        }}>
                            Team Members
                        </label>

                        {memberError && (
                            <div style={{ ...glassErrorBoxStyle, marginBottom: 16 }}>
                                {memberError}
                            </div>
                        )}

                        {/* Current Members List */}
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            marginBottom: 16
                        }}>
                            {members.map(member => (
                                <div
                                    key={member.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        padding: '10px 12px',
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        borderRadius: radius.md,
                                        border: `1px solid ${colors.glass.borderSubtle}`
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            color: colors.text.primary,
                                            fontSize: 14,
                                            fontWeight: 500,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {member.profile?.display_name || member.profile?.email || 'Unknown'}
                                        </div>
                                        <div style={{
                                            color: colors.text.subtle,
                                            fontSize: 12
                                        }}>
                                            {member.profile?.email}
                                        </div>
                                    </div>

                                    {/* Role selector (owners can change roles) */}
                                    {isOwner && member.role !== 'owner' ? (
                                        <select
                                            value={member.role}
                                            onChange={(e) => handleRoleChange(member.user_id, e.target.value as JourneyRole)}
                                            style={{
                                                ...glassInputStyle,
                                                width: 'auto',
                                                padding: '6px 10px',
                                                fontSize: 12,
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <option value="editor">Editor</option>
                                            <option value="viewer">Viewer</option>
                                        </select>
                                    ) : (
                                        <span style={{
                                            padding: '4px 10px',
                                            borderRadius: radius.sm,
                                            fontSize: 12,
                                            fontWeight: 500,
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.05em',
                                            background: member.role === 'owner'
                                                ? 'rgba(251, 191, 36, 0.2)'
                                                : member.role === 'editor'
                                                    ? 'rgba(96, 165, 250, 0.2)'
                                                    : 'rgba(255, 255, 255, 0.1)',
                                            color: member.role === 'owner'
                                                ? '#fbbf24'
                                                : member.role === 'editor'
                                                    ? '#60a5fa'
                                                    : colors.text.secondary
                                        }}>
                                            {member.role}
                                        </span>
                                    )}

                                    {/* Remove button (owners can remove non-owners) */}
                                    {isOwner && member.role !== 'owner' && (
                                        <button
                                            onClick={() => handleRemoveMember(member.user_id)}
                                            style={{
                                                background: 'rgba(239, 68, 68, 0.2)',
                                                border: 'none',
                                                borderRadius: radius.sm,
                                                padding: '6px 10px',
                                                color: '#ef4444',
                                                fontSize: 12,
                                                cursor: 'pointer',
                                                transition: `all ${transitions.fast}`
                                            }}
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>
                            ))}

                            {members.length === 0 && (
                                <div style={{
                                    color: colors.text.subtle,
                                    fontSize: 14,
                                    textAlign: 'center',
                                    padding: 20
                                }}>
                                    No members yet
                                </div>
                            )}
                        </div>

                        {/* Add Member (owners only) */}
                        {isOwner && availableUsers.length > 0 && (
                            <div style={{
                                display: 'flex',
                                gap: 8,
                                alignItems: 'flex-end'
                            }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ ...glassLabelStyle, fontSize: 12 }}>Add Member</label>
                                    <select
                                        value={selectedUserId}
                                        onChange={(e) => setSelectedUserId(e.target.value)}
                                        style={{
                                            ...glassInputStyle,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <option value="">Select user...</option>
                                        {availableUsers.map(user => (
                                            <option key={user.id} value={user.id}>
                                                {user.display_name || user.email}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ ...glassLabelStyle, fontSize: 12 }}>Role</label>
                                    <select
                                        value={selectedRole}
                                        onChange={(e) => setSelectedRole(e.target.value as JourneyRole)}
                                        style={{
                                            ...glassInputStyle,
                                            width: 'auto',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <option value="editor">Editor</option>
                                        <option value="viewer">Viewer</option>
                                    </select>
                                </div>
                                <GlassButton
                                    variant="primary"
                                    size="sm"
                                    onClick={handleAddMember}
                                    disabled={!selectedUserId || addingMember}
                                    style={{ marginBottom: 0 }}
                                >
                                    {addingMember ? '...' : 'Add'}
                                </GlassButton>
                            </div>
                        )}

                        {isOwner && availableUsers.length === 0 && members.length > 0 && (
                            <div style={glassInfoBoxStyle}>
                                All registered users are already members of this journey.
                            </div>
                        )}

                        {!isOwner && (
                            <div style={glassInfoBoxStyle}>
                                Only journey owners can manage members.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </GlassModal>
    );
});
