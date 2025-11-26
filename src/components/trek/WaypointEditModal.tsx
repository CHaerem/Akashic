import { memo, useState, useEffect, useCallback } from 'react';
import { getWaypoint, updateWaypoint, type DbWaypoint, type WaypointUpdate } from '../../lib/journeys';
import type { Camp, Photo } from '../../types/trek';

interface WaypointEditModalProps {
    camp: Camp;
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    isMobile: boolean;
    photos?: Photo[];
    getMediaUrl?: (path: string) => string;
}

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: 'white',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box'
};

const labelStyle: React.CSSProperties = {
    display: 'block',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    marginBottom: 8
};

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

    if (!isOpen) return null;

    // Photos assigned to this waypoint
    const assignedPhotos = photos.filter(p => p.waypoint_id === camp.id);

    const modalStyle: React.CSSProperties = {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 24
    };

    const overlayStyle: React.CSSProperties = {
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)'
    };

    const contentStyle: React.CSSProperties = {
        position: 'relative',
        background: 'rgba(15, 15, 20, 0.98)',
        borderRadius: isMobile ? '20px 20px 0 0' : 16,
        width: isMobile ? '100%' : '100%',
        maxWidth: 500,
        maxHeight: isMobile ? '90dvh' : '80vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(255,255,255,0.1)'
    };

    const headerStyle: React.CSSProperties = {
        padding: isMobile ? '20px 20px 16px' : 24,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    };

    const bodyStyle: React.CSSProperties = {
        flex: 1,
        overflow: 'auto',
        padding: isMobile ? 20 : 24,
        WebkitOverflowScrolling: 'touch'
    };

    const footerStyle: React.CSSProperties = {
        padding: isMobile ? '16px 20px' : '16px 24px',
        paddingBottom: isMobile ? 'calc(16px + env(safe-area-inset-bottom))' : 16,
        borderTop: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        gap: 12,
        justifyContent: 'flex-end'
    };

    const buttonBase: React.CSSProperties = {
        padding: '12px 24px',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
        border: 'none',
        minHeight: 44,
        transition: 'opacity 0.2s'
    };

    return (
        <div style={modalStyle}>
            <div style={overlayStyle} onClick={onClose} />
            <div style={contentStyle}>
                {/* Header */}
                <div style={headerStyle}>
                    <h2 style={{ color: 'white', fontSize: 18, fontWeight: 500, margin: 0 }}>
                        Edit Day {camp.dayNumber}
                    </h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255,255,255,0.1)',
                            border: 'none',
                            color: 'rgba(255,255,255,0.7)',
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            cursor: 'pointer',
                            fontSize: 18
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* Body */}
                <div style={bodyStyle}>
                    {loading ? (
                        <div style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: 40 }}>
                            Loading...
                        </div>
                    ) : error ? (
                        <div style={{ color: '#ef4444', textAlign: 'center', padding: 40 }}>
                            {error}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {/* Name */}
                            <div>
                                <label style={labelStyle}>Camp/Location Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    style={inputStyle}
                                    placeholder="e.g., Base Camp"
                                />
                            </div>

                            {/* Day Number & Elevation */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={labelStyle}>Day Number</label>
                                    <input
                                        type="number"
                                        value={dayNumber}
                                        onChange={e => setDayNumber(e.target.value)}
                                        style={inputStyle}
                                        placeholder="1"
                                        min="1"
                                    />
                                </div>
                                <div>
                                    <label style={labelStyle}>Elevation (m)</label>
                                    <input
                                        type="number"
                                        value={elevation}
                                        onChange={e => setElevation(e.target.value)}
                                        style={inputStyle}
                                        placeholder="e.g., 3200"
                                    />
                                </div>
                            </div>

                            {/* Description */}
                            <div>
                                <label style={labelStyle}>Description</label>
                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                                    placeholder="Notes about this day..."
                                />
                            </div>

                            {/* Highlights */}
                            <div>
                                <label style={labelStyle}>Highlights (one per line)</label>
                                <textarea
                                    value={highlightsText}
                                    onChange={e => setHighlightsText(e.target.value)}
                                    style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                                    placeholder="Scenic viewpoint&#10;Wildlife sighting&#10;Challenging terrain"
                                />
                            </div>

                            {/* Assigned Photos */}
                            {assignedPhotos.length > 0 && (
                                <div>
                                    <label style={labelStyle}>Assigned Photos ({assignedPhotos.length})</label>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(4, 1fr)',
                                        gap: 6
                                    }}>
                                        {assignedPhotos.slice(0, 8).map(photo => (
                                            <div
                                                key={photo.id}
                                                style={{
                                                    aspectRatio: '1',
                                                    borderRadius: 6,
                                                    overflow: 'hidden',
                                                    background: 'rgba(255,255,255,0.05)'
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
                                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 8 }}>
                                            +{assignedPhotos.length - 8} more photos
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={footerStyle}>
                    <button
                        onClick={onClose}
                        style={{
                            ...buttonBase,
                            background: 'rgba(255,255,255,0.1)',
                            color: 'rgba(255,255,255,0.7)'
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || loading}
                        style={{
                            ...buttonBase,
                            background: '#3b82f6',
                            color: 'white',
                            opacity: saving || loading ? 0.5 : 1
                        }}
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
});
