import { memo, useState, useEffect, useCallback } from 'react';
import { getJourneyForEdit, updateJourney, type DbJourney, type JourneyUpdate } from '../../lib/journeys';
import { GlassModal, glassInputStyle, glassLabelStyle, glassInfoBoxStyle, glassErrorBoxStyle } from '../common/GlassModal';
import { GlassButton } from '../common/GlassButton';
import { colors, transitions } from '../../styles/liquidGlass';

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
                </div>
            )}
        </GlassModal>
    );
});
