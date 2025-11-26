import { memo, useState, useEffect, useCallback } from 'react';
import { getJourneyForEdit, updateJourney, type DbJourney, type JourneyUpdate } from '../../lib/journeys';

interface JourneyEditModalProps {
    slug: string;
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    isMobile: boolean;
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

    // Load journey data
    useEffect(() => {
        if (!isOpen || !slug) return;

        setLoading(true);
        setError(null);

        getJourneyForEdit(slug).then(data => {
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

    if (!isOpen) return null;

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
                        Edit Journey
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
                                <label style={labelStyle}>Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    style={inputStyle}
                                    placeholder="Journey name"
                                />
                            </div>

                            {/* Country */}
                            <div>
                                <label style={labelStyle}>Country</label>
                                <input
                                    type="text"
                                    value={country}
                                    onChange={e => setCountry(e.target.value)}
                                    style={inputStyle}
                                    placeholder="e.g., Peru"
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label style={labelStyle}>Description</label>
                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                                    placeholder="Journey description..."
                                />
                            </div>

                            {/* Dates */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={labelStyle}>Start Date</label>
                                    <input
                                        type="date"
                                        value={dateStarted}
                                        onChange={e => setDateStarted(e.target.value)}
                                        style={{ ...inputStyle, colorScheme: 'dark' }}
                                    />
                                </div>
                                <div>
                                    <label style={labelStyle}>End Date</label>
                                    <input
                                        type="date"
                                        value={dateEnded}
                                        onChange={e => setDateEnded(e.target.value)}
                                        style={{ ...inputStyle, colorScheme: 'dark' }}
                                    />
                                </div>
                            </div>

                            {/* Stats */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={labelStyle}>Days</label>
                                    <input
                                        type="number"
                                        value={totalDays}
                                        onChange={e => setTotalDays(e.target.value)}
                                        style={inputStyle}
                                        placeholder="e.g., 5"
                                        min="1"
                                    />
                                </div>
                                <div>
                                    <label style={labelStyle}>Distance (km)</label>
                                    <input
                                        type="number"
                                        value={totalDistance}
                                        onChange={e => setTotalDistance(e.target.value)}
                                        style={inputStyle}
                                        placeholder="e.g., 45"
                                        step="0.1"
                                    />
                                </div>
                                <div>
                                    <label style={labelStyle}>Summit (m)</label>
                                    <input
                                        type="number"
                                        value={summitElevation}
                                        onChange={e => setSummitElevation(e.target.value)}
                                        style={inputStyle}
                                        placeholder="e.g., 4215"
                                    />
                                </div>
                            </div>

                            {/* Info about date matching */}
                            {dateStarted && (
                                <div style={{
                                    background: 'rgba(59, 130, 246, 0.1)',
                                    border: '1px solid rgba(59, 130, 246, 0.2)',
                                    borderRadius: 8,
                                    padding: 12,
                                    fontSize: 12,
                                    color: 'rgba(255,255,255,0.6)',
                                    lineHeight: 1.5
                                }}>
                                    Photos will be matched to days based on this start date.
                                    Day 1 = {new Date(dateStarted).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
