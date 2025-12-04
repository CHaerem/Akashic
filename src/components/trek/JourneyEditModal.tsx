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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../ui/dialog';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetFooter,
} from '../ui/sheet';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Card } from '../ui/card';
import { cn } from '@/lib/utils';

interface JourneyEditModalProps {
    slug: string;
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    isMobile: boolean;
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

    const formContent = (
        <>
            {loading ? (
                <div className="text-white/50 light:text-slate-400 text-center py-10">
                    Loading...
                </div>
            ) : error ? (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                </div>
            ) : (
                <div className="flex flex-col gap-5">
                    {/* Name */}
                    <div className="space-y-2">
                        <Label>Name</Label>
                        <Input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Journey name"
                        />
                    </div>

                    {/* Country */}
                    <div className="space-y-2">
                        <Label>Country</Label>
                        <Input
                            type="text"
                            value={country}
                            onChange={e => setCountry(e.target.value)}
                            placeholder="e.g., Peru"
                        />
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Journey description..."
                        />
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>Start Date</Label>
                            <Input
                                type="date"
                                value={dateStarted}
                                onChange={e => setDateStarted(e.target.value)}
                                className="[color-scheme:dark] light:[color-scheme:light]"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>End Date</Label>
                            <Input
                                type="date"
                                value={dateEnded}
                                onChange={e => setDateEnded(e.target.value)}
                                className="[color-scheme:dark] light:[color-scheme:light]"
                            />
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                            <Label>Days</Label>
                            <Input
                                type="number"
                                value={totalDays}
                                onChange={e => setTotalDays(e.target.value)}
                                placeholder="e.g., 5"
                                min={1}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Distance (km)</Label>
                            <Input
                                type="number"
                                value={totalDistance}
                                onChange={e => setTotalDistance(e.target.value)}
                                placeholder="e.g., 45"
                                step={0.1}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Summit (m)</Label>
                            <Input
                                type="number"
                                value={summitElevation}
                                onChange={e => setSummitElevation(e.target.value)}
                                placeholder="e.g., 4215"
                            />
                        </div>
                    </div>

                    {/* Info about date matching */}
                    {dateStarted && (
                        <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 light:text-blue-700 text-sm">
                            Photos will be matched to days based on this start date.
                            Day 1 = {new Date(dateStarted).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                    )}

                    {/* Members Section */}
                    <div className="mt-6 pt-6 border-t border-white/10 light:border-black/5">
                        <Label className="text-sm mb-4 block">Team Members</Label>

                        {memberError && (
                            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
                                {memberError}
                            </div>
                        )}

                        {/* Current Members List */}
                        <div className="flex flex-col gap-2 mb-4">
                            {members.map(member => (
                                <Card
                                    key={member.id}
                                    variant="subtle"
                                    className="flex items-center gap-3 p-3"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="text-white/95 light:text-slate-900 text-sm font-medium truncate">
                                            {member.profile?.display_name || member.profile?.email || 'Unknown'}
                                        </div>
                                        <div className="text-white/35 light:text-slate-400 text-xs">
                                            {member.profile?.email}
                                        </div>
                                    </div>

                                    {/* Role selector (owners can change roles) */}
                                    {isOwner && member.role !== 'owner' ? (
                                        <Select
                                            value={member.role}
                                            onValueChange={(value) => handleRoleChange(member.user_id, value as JourneyRole)}
                                        >
                                            <SelectTrigger className="w-24 h-9 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="editor">Editor</SelectItem>
                                                <SelectItem value="viewer">Viewer</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <span className={cn(
                                            "px-2.5 py-1 rounded-lg text-xs font-medium uppercase tracking-wide",
                                            member.role === 'owner' && "bg-yellow-500/20 text-yellow-400",
                                            member.role === 'editor' && "bg-blue-500/20 text-blue-400",
                                            member.role === 'viewer' && "bg-white/10 text-white/70 light:bg-black/5 light:text-slate-600"
                                        )}>
                                            {member.role}
                                        </span>
                                    )}

                                    {/* Remove button (owners can remove non-owners) */}
                                    {isOwner && member.role !== 'owner' && (
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() => handleRemoveMember(member.user_id)}
                                            className="h-9"
                                        >
                                            Remove
                                        </Button>
                                    )}
                                </Card>
                            ))}

                            {members.length === 0 && (
                                <div className="text-white/35 light:text-slate-400 text-sm text-center py-5">
                                    No members yet
                                </div>
                            )}
                        </div>

                        {/* Add Member (owners only) */}
                        {isOwner && availableUsers.length > 0 && (
                            <div className="flex gap-2 items-end">
                                <div className="flex-1 space-y-2">
                                    <Label className="text-xs">Add Member</Label>
                                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select user..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {availableUsers.map(user => (
                                                <SelectItem key={user.id} value={user.id}>
                                                    {user.display_name || user.email}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Role</Label>
                                    <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as JourneyRole)}>
                                        <SelectTrigger className="w-24">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="editor">Editor</SelectItem>
                                            <SelectItem value="viewer">Viewer</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={handleAddMember}
                                    disabled={!selectedUserId || addingMember}
                                >
                                    {addingMember ? '...' : 'Add'}
                                </Button>
                            </div>
                        )}

                        {isOwner && availableUsers.length === 0 && members.length > 0 && (
                            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 light:text-blue-700 text-sm">
                                All registered users are already members of this journey.
                            </div>
                        )}

                        {!isOwner && (
                            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 light:text-blue-700 text-sm">
                                Only journey owners can manage members.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );

    const footerContent = (
        <>
            <Button variant="subtle" onClick={onClose}>
                Cancel
            </Button>
            <Button
                variant="primary"
                onClick={handleSave}
                disabled={saving || loading}
            >
                {saving ? 'Saving...' : 'Save Changes'}
            </Button>
        </>
    );

    // Use Sheet for mobile, Dialog for desktop
    if (isMobile) {
        return (
            <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>Edit Journey</SheetTitle>
                    </SheetHeader>
                    <div className="px-6 py-4 overflow-y-auto">
                        {formContent}
                    </div>
                    <SheetFooter>
                        {footerContent}
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Journey</DialogTitle>
                </DialogHeader>
                {formContent}
                <DialogFooter>
                    {footerContent}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
});
