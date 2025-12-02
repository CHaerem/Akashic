import { useMemo, type CSSProperties } from 'react';
import type { TrekData, Camp, Photo, TabType } from '../../types/trek';
import type { PanelState } from '../trek/InfoPanel';
import { colors, gradients, radius, transitions, typography } from '../../styles/liquidGlass';
import { GlassButton } from '../common/GlassButton';

interface MobileExperienceProps {
  trekData: TrekData;
  selectedCamp: Camp | null;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onCampSelect: (camp: Camp) => void;
  panelState: PanelState;
  onPanelStateChange: (state: PanelState) => void;
  photos: Photo[];
  getMediaUrl?: (path: string) => string;
  onBack: () => void;
}

function getDateForDay(dateStarted: string | undefined, dayNumber: number): Date | null {
  if (!dateStarted) return null;
  const start = new Date(dateStarted);
  start.setDate(start.getDate() + (dayNumber - 1));
  return start;
}

function isPhotoFromDay(photo: Photo, targetDate: Date): boolean {
  if (!photo.taken_at) return false;
  const photoDate = new Date(photo.taken_at);
  return (
    photoDate.getFullYear() === targetDate.getFullYear() &&
    photoDate.getMonth() === targetDate.getMonth() &&
    photoDate.getDate() === targetDate.getDate()
  );
}

export function MobileExperience({
    trekData,
    selectedCamp,
    activeTab,
    setActiveTab,
    onCampSelect,
    panelState,
    onPanelStateChange,
    photos,
    getMediaUrl = (path) => path,
    onBack,
}: MobileExperienceProps) {
  // Only render when the bottom sheet is minimized to avoid stacking overlays
  if (panelState !== 'minimized') return null;

  const sortedCamps = useMemo(
    () => [...trekData.camps].sort((a, b) => a.dayNumber - b.dayNumber),
    [trekData.camps]
  );

  if (!sortedCamps.length) return null;

  // Map photos to camps for the rail: prefer assigned, then date-matched, then first photo
  const campPhotos = useMemo(() => {
    return sortedCamps.map((camp) => {
      const date = getDateForDay(trekData.dateStarted, camp.dayNumber);
      const dateMatch = date ? photos.find((p) => isPhotoFromDay(p, date)) : undefined;
      const assigned = photos.find((p) => p.waypoint_id === camp.id);
      return assigned || dateMatch || photos[0] || null;
    });
  }, [sortedCamps, trekData.dateStarted, photos]);

  const heroPhoto = useMemo(() => photos.find((p) => p.is_hero) || photos[0] || null, [photos]);

  const progressPercent = useMemo(() => {
    const activeIndex = selectedCamp
      ? sortedCamps.findIndex((c) => c.id === selectedCamp.id)
      : 0;
    if (activeIndex < 0) return 0;
    return Math.min(100, Math.round(((activeIndex + 1) / sortedCamps.length) * 100));
  }, [selectedCamp, sortedCamps]);

  const dockActive = (() => {
    if (panelState === 'minimized') return 'explore';
    if (activeTab === 'photos') return 'photos';
    if (activeTab === 'stats') return 'stats';
    return 'journey';
  })();

  const cardShadow = `
    0 14px 44px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.12)
  `;

  const railCard: CSSProperties = {
    position: 'relative',
    width: 170,
    minWidth: 170,
    borderRadius: radius.lg,
    overflow: 'hidden',
    background: colors.glass.subtle,
    border: `1px solid ${colors.glass.borderSubtle}`,
    boxShadow: cardShadow,
    cursor: 'pointer',
    transition: `transform ${transitions.smooth}, border-color ${transitions.smooth}`,
  };

  const chipStyle: CSSProperties = {
    background: colors.glass.subtle,
    border: `1px solid ${colors.glass.borderSubtle}`,
    borderRadius: radius.md,
    padding: '8px 10px',
    color: colors.text.secondary,
    fontSize: 12,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  const pressTab = (tab: TabType) => {
    setActiveTab(tab);
    onPanelStateChange('expanded');
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 19,
      }}
    >
      {/* Top cluster: brand, hero card */}
      <div
        style={{
          position: 'absolute',
          top: 'max(12px, env(safe-area-inset-top))',
          left: 12,
          right: 12,
          display: 'grid',
          gap: 10,
          pointerEvents: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderRadius: radius.lg,
            background: gradients.glass.subtle,
            border: `1px solid ${colors.glass.borderSubtle}`,
            boxShadow: cardShadow,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: radius.pill,
                background: colors.accent.primary,
                boxShadow: '0 0 12px rgba(96,165,250,0.6)',
              }}
            />
            <div>
              <div style={{ ...typography.label, color: colors.text.secondary, margin: 0 }}>Akashic</div>
              <div style={{ color: colors.text.tertiary, fontSize: 12 }}>Liquid glass · calm</div>
            </div>
          </div>
          <GlassButton size="sm" variant="ghost" onClick={onBack} style={{ padding: '10px 12px' }}>
            Globe
          </GlassButton>
        </div>

        <div
          style={{
            position: 'relative',
            borderRadius: radius.xxl,
            overflow: 'hidden',
            background: gradients.glass.panel,
            border: `1px solid ${colors.glass.border}`,
            boxShadow: cardShadow,
          }}
        >
          {heroPhoto && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: 0.4,
                filter: 'blur(6px) saturate(140%)',
                backgroundImage: `url(${getMediaUrl(heroPhoto.thumbnail_url || heroPhoto.url)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                transform: 'scale(1.05)',
              }}
            />
          )}
          <div
            style={{
              position: 'relative',
              padding: '18px 18px 16px',
              display: 'grid',
              gap: 10,
              background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.65) 60%)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: radius.pill,
                  background: `conic-gradient(${colors.accent.primary} ${progressPercent}%, rgba(255,255,255,0.08) ${progressPercent}% 100%)`,
                  display: 'grid',
                  placeItems: 'center',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radius.pill,
                    background: colors.background.elevated,
                    display: 'grid',
                    placeItems: 'center',
                    color: colors.text.primary,
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  {progressPercent}%
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ ...typography.label, color: colors.text.subtle, margin: 0 }}>Journey</p>
                <h2
                  style={{
                    ...typography.display,
                    fontSize: 22,
                    margin: 0,
                    color: colors.text.primary,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {trekData.name}
                </h2>
                <div style={{ color: colors.text.tertiary, fontSize: 12 }}>{trekData.country}</div>
              </div>

              <GlassButton
                size="sm"
                variant="subtle"
                onClick={() => pressTab('overview')}
                style={{ padding: '10px 12px' }}
              >
                Story deck
              </GlassButton>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={chipStyle}>
                <span style={{ color: colors.text.subtle, fontSize: 12 }}>Days</span>
                <strong style={{ color: colors.text.primary }}>{trekData.stats.duration}</strong>
              </div>
              <div style={chipStyle}>
                <span style={{ color: colors.text.subtle, fontSize: 12 }}>Distance</span>
                <strong style={{ color: colors.text.primary }}>{trekData.stats.totalDistance} km</strong>
              </div>
              <div style={chipStyle}>
                <span style={{ color: colors.text.subtle, fontSize: 12 }}>Ascent</span>
                <strong style={{ color: colors.text.primary }}>+{trekData.stats.totalElevationGain} m</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Memory rail */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 176px)',
          left: 12,
          right: 12,
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 12 }}>
          <h3
            style={{
              ...typography.heading,
              fontSize: 14,
              margin: 0,
              color: colors.text.secondary,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Memory lane
          </h3>
          <div style={{ color: colors.text.tertiary, fontSize: 12 }}>Scroll & tap to fly the map</div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            paddingBottom: 6,
            WebkitOverflowScrolling: 'touch',
          }}
          className="glass-scrollbar"
        >
          {sortedCamps.map((camp, index) => {
            const photo = campPhotos[index];
            const isActive = selectedCamp?.id === camp.id;
            return (
              <div
                key={camp.id}
                onClick={() => {
                  onCampSelect(camp);
                  pressTab('journey');
                }}
                style={{
                  ...railCard,
                  border: isActive
                    ? `1px solid ${colors.accent.primary}`
                    : railCard.border,
                  transform: isActive ? 'translateY(-4px)' : 'translateY(0)',
                }}
              >
                {photo && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundImage: `url(${getMediaUrl(photo.thumbnail_url || photo.url)})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      filter: 'brightness(0.9)',
                    }}
                  />
                )}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.6) 70%)',
                  }}
                />
                <div style={{ position: 'relative', padding: '12px 12px 14px', height: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span
                      style={{
                        ...typography.label,
                        color: isActive ? colors.accent.primary : colors.text.subtle,
                        fontSize: 10,
                        margin: 0,
                      }}
                    >
                      Day {camp.dayNumber}
                    </span>
                    <span style={{ color: colors.text.tertiary, fontSize: 12 }}>{camp.elevation}m</span>
                  </div>
                  <div
                    style={{
                      ...typography.heading,
                      color: colors.text.primary,
                      marginTop: 6,
                      fontSize: 15,
                      lineHeight: 1.3,
                    }}
                  >
                    {camp.name}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Photo chips */}
      {photos.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 300px)',
            left: 12,
            right: 12,
            pointerEvents: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 12 }}>
            <h3
              style={{
                ...typography.heading,
                fontSize: 14,
                margin: 0,
                color: colors.text.secondary,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Quick memories
            </h3>
            <div style={{ color: colors.text.tertiary, fontSize: 12 }}>{photos.length} photos</div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
              gap: 8,
            }}
          >
            {photos.slice(0, 8).map((photo) => (
              <div
                key={photo.id}
                style={{
                  position: 'relative',
                  paddingBottom: '75%',
                  borderRadius: radius.md,
                  overflow: 'hidden',
                  background: colors.glass.subtle,
                  border: `1px solid ${colors.glass.borderSubtle}`,
                }}
              >
                <img
                  src={getMediaUrl(photo.thumbnail_url || photo.url)}
                  alt={photo.caption || 'Journey memory'}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                  loading="lazy"
                />
                {photo.caption && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.65) 100%)',
                    }}
                  />
                )}
                {photo.caption && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 8,
                      right: 8,
                      bottom: 6,
                      color: colors.text.primary,
                      fontSize: 11,
                      textShadow: '0 2px 6px rgba(0,0,0,0.6)',
                    }}
                  >
                    {photo.caption}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dock */}
      <div
        style={{
          position: 'absolute',
          bottom: 'max(12px, env(safe-area-inset-bottom))',
          left: 12,
          right: 12,
          pointerEvents: 'auto',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 8,
            padding: 12,
            borderRadius: radius.xxl,
            background: `linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(10,10,15,0.9) 100%)`,
            border: `1px solid ${colors.glass.border}`,
            boxShadow: `0 12px 32px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255,255,255,0.12)`,
          }}
        >
          {[{
            key: 'explore',
            label: 'Explore',
            onPress: () => onPanelStateChange('minimized'),
          }, {
            key: 'journey',
            label: 'Journey',
            onPress: () => pressTab('journey'),
          }, {
            key: 'photos',
            label: 'Photos',
            onPress: () => pressTab('photos'),
          }, {
            key: 'stats',
            label: 'Stats',
            onPress: () => pressTab('stats'),
          }].map((item) => {
            const isActive = dockActive === item.key;
            return (
              <button
                key={item.key}
                onClick={item.onPress}
                style={{
                  border: 'none',
                  borderRadius: radius.lg,
                  padding: '12px 10px',
                  background: isActive ? colors.glass.medium : colors.glass.subtle,
                  color: isActive ? colors.text.primary : colors.text.secondary,
                  boxShadow: isActive ? '0 6px 18px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.16)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  fontSize: 13,
                  transition: `all ${transitions.smooth}`,
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
