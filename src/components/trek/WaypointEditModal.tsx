import { memo, useState, useEffect, useCallback } from 'react';
import { getWaypoint, updateWaypoint, type DbWaypoint, type WaypointUpdate } from '../../lib/journeys';
import type { Camp, Photo } from '../../types/trek';
import { GlassModal, glassInputStyle, glassLabelStyle, glassErrorBoxStyle } from '../common/GlassModal';
import { GlassButton } from '../common/GlassButton';
import { colors, radius } from '../../styles/liquidGlass';

interface WaypointEditModalProps {
    camp: Camp;
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    isMobile: boolean;
    photos?: Photo[];
    getMediaUrl?: (path: string) => string;
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
    minHeight = 80,
    ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { style?: React.CSSProperties; minHeight?: number }) {
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
                minHeight,
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

export const WaypointEditModal = memo(function WaypointEditModal({
    camp,
    isOpen,
    onClose,
    onSave,
    isMobile,
    photos = [],
    getMediaUrl = (path) => path
}: WaypointEditModalProps) {
    const [waypoint, setWaypoint] = useState<DbWaypoint | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [elevation, setElevation] = useState('');
    const [dayNumber, setDayNumber] = useState('');
    const [highlightsText, setHighlightsText] = useState('');

    // Load waypoint data
    useEffect(() => {
        if (!isOpen || !camp.id) return;

        setLoading(true);
        setError(null);

        getWaypoint(camp.id).then(data => {
            if (data) {
                setWaypoint(data);
                setName(data.name || '');
                setDescription(data.description || '');
                setElevation(data.elevation?.toString() || '');
                setDayNumber(data.day_number?.toString() || '');
                setHighlightsText((data.highlights || []).join('\n'));
            }
            setLoading(false);
        }).catch(err => {
            setError(err.message);
            setLoading(false);
        });
    }, [isOpen, camp.id]);

    const handleSave = useCallback(async () => {
        if (!waypoint) return;

        setSaving(true);
        setError(null);

        try {
            const highlights = highlightsText
                .split('\n')
                .map(h => h.trim())
                .filter(h => h.length > 0);

            const updates: WaypointUpdate = {
                name: name || waypoint.name,
                description: description || null,
                elevation: elevation ? parseInt(elevation, 10) : null,
                day_number: dayNumber ? parseInt(dayNumber, 10) : null,
                highlights: highlights.length > 0 ? highlights : null
            };

            await updateWaypoint(camp.id, updates);
            onSave();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    }, [waypoint, camp.id, name, description, elevation, dayNumber, highlightsText, onSave, onClose]);

    // Photos assigned to this waypoint
    const assignedPhotos = photos.filter(p => p.waypoint_id === camp.id);

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
            title={`Edit Day ${camp.dayNumber}`}
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
                        <label style={glassLabelStyle}>Camp/Location Name</label>
                        <GlassInput
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g., Base Camp"
                        />
                    </div>

                    {/* Day Number & Elevation */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                            <label style={glassLabelStyle}>Day Number</label>
                            <GlassInput
                                type="number"
                                value={dayNumber}
                                onChange={e => setDayNumber(e.target.value)}
                                placeholder="1"
                                min={1}
                            />
                        </div>
                        <div>
                            <label style={glassLabelStyle}>Elevation (m)</label>
                            <GlassInput
                                type="number"
                                value={elevation}
                                onChange={e => setElevation(e.target.value)}
                                placeholder="e.g., 3200"
                            />
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <label style={glassLabelStyle}>Description</label>
                        <GlassTextarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Notes about this day..."
                            minHeight={80}
                        />
                    </div>

                    {/* Highlights */}
                    <div>
                        <label style={glassLabelStyle}>Highlights (one per line)</label>
                        <GlassTextarea
                            value={highlightsText}
                            onChange={e => setHighlightsText(e.target.value)}
                            placeholder={`Scenic viewpoint\nWildlife sighting\nChallenging terrain`}
                            minHeight={80}
                        />
                    </div>

                    {/* Assigned Photos */}
                    {assignedPhotos.length > 0 && (
                        <div>
                            <label style={glassLabelStyle}>Assigned Photos ({assignedPhotos.length})</label>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(4, 1fr)',
                                gap: 8,
                                marginTop: 4,
                            }}>
                                {assignedPhotos.slice(0, 8).map(photo => (
                                    <div
                                        key={photo.id}
                                        style={{
                                            aspectRatio: '1',
                                            borderRadius: radius.sm,
                                            overflow: 'hidden',
                                            background: `linear-gradient(
                                                135deg,
                                                rgba(255, 255, 255, 0.06) 0%,
                                                rgba(255, 255, 255, 0.02) 100%
                                            )`,
                                            border: `1px solid ${colors.glass.borderSubtle}`,
                                        }}
                                    >
                                        <img
                                            src={getMediaUrl(photo.thumbnail_url || photo.url)}
                                            alt={photo.caption || 'Photo'}
                                            style={{
                                                width: '100%',
                                                height: '100%',
                                                objectFit: 'cover'
                                            }}
                                            loading="lazy"
                                        />
                                    </div>
                                ))}
                            </div>
                            {assignedPhotos.length > 8 && (
                                <p style={{ color: colors.text.subtle, fontSize: 12, marginTop: 8 }}>
                                    +{assignedPhotos.length - 8} more photos
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </GlassModal>
    );
});
