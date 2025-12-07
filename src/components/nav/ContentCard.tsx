/**
 * Content Card component for displaying tab content in a floating glass card
 * Extracted from AdaptiveNavPill for better organization
 */

import { memo, useState, type RefObject } from 'react';
import { motion } from 'framer-motion';
import { colors, radius, shadows, effects } from '../../styles/liquidGlass';
import type { Camp, TabType, TrekData, ExtendedStats, ElevationProfile, Photo } from '../../types/trek';
import { StatsTab } from '../trek/StatsTab';
import { JourneyTab } from '../trek/JourneyTab';
import { OverviewTab } from '../trek/OverviewTab';
import { PhotosTab } from '../trek/PhotosTab';
import { JourneyEditModal } from '../trek/JourneyEditModal';
import { Button } from '../ui/button';
import { ErrorBoundary, ComponentErrorFallback } from '../common/ErrorBoundary';
import { CloseIcon, PencilIcon } from '../icons';

const SPRING_CONFIG = {
  mass: 0.1,
  stiffness: 200,
  damping: 15,
};

interface ContentCardProps {
  activeTab: TabType;
  trekData: TrekData;
  extendedStats: ExtendedStats | null;
  elevationProfile: ElevationProfile | null;
  selectedCamp: Camp | null;
  photos: Photo[];
  getMediaUrl: (path: string) => string;
  onClose: () => void;
  onCampSelect: (camp: Camp) => void;
  onPhotoClick: (photo: Photo) => void;
  onJourneyUpdate: () => void;
  isMobile: boolean;
  cardRef: RefObject<HTMLDivElement | null>;
  /** When true, renders content only without wrapper/header - for embedding in other components */
  embedded?: boolean;
}

export const ContentCard = memo(function ContentCard({
  activeTab,
  trekData,
  extendedStats,
  elevationProfile,
  selectedCamp,
  photos,
  getMediaUrl,
  onClose,
  onCampSelect,
  onPhotoClick,
  onJourneyUpdate,
  isMobile,
  cardRef,
  embedded = false,
}: ContentCardProps) {
  const [editMode, setEditMode] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const glassStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)`,
    backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    border: `1px solid ${colors.glass.border}`,
    boxShadow: shadows.glass.elevated,
  };

  const cardWidth = isMobile ? 'calc(100vw - 32px)' : '420px';
  // Leave space for nav pill (approx 100px) + safe area on mobile
  const maxHeight = isMobile
    ? 'calc(100vh - 160px - env(safe-area-inset-top) - env(safe-area-inset-bottom))'
    : '70vh';

  // Embedded mode: render content only, no wrapper
  if (embedded) {
    return (
      <div style={{ padding: 16 }}>
        {activeTab === 'overview' && (
          <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load overview" />}>
            <OverviewTab trekData={trekData} />
          </ErrorBoundary>
        )}

        {activeTab === 'stats' && (
          <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load stats" />}>
            <StatsTab
              trekData={trekData}
              extendedStats={extendedStats}
              elevationProfile={elevationProfile}
              isMobile={isMobile}
              selectedCamp={selectedCamp}
              onCampSelect={onCampSelect}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'photos' && (
          <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load photos" />}>
            <PhotosTab trekData={trekData} isMobile={isMobile} editMode={editMode} onViewPhotoOnMap={onPhotoClick} />
          </ErrorBoundary>
        )}

        {activeTab === 'journey' && (
          <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load journey" />}>
            <JourneyTab
              trekData={trekData}
              selectedCamp={selectedCamp}
              onCampSelect={onCampSelect}
              isMobile={isMobile}
              photos={photos}
              getMediaUrl={getMediaUrl}
              onUpdate={onJourneyUpdate}
              editMode={editMode}
              onViewPhotoOnMap={onPhotoClick}
            />
          </ErrorBoundary>
        )}
      </div>
    );
  }

  return (
    // Wrapper for centering - handles the positioning
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: isMobile ? 'env(safe-area-inset-top)' : 0,
        paddingBottom: isMobile ? 'calc(100px + env(safe-area-inset-bottom))' : 0,
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      <motion.div
        ref={cardRef}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 5 }}
        transition={{ type: 'spring', ...SPRING_CONFIG }}
        style={{
          ...glassStyle,
          width: cardWidth,
          maxWidth: cardWidth,
          maxHeight,
          borderRadius: radius.xl,
          overflow: 'hidden',
          pointerEvents: 'auto',
        }}
      >
        {/* Header with camp context */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: `1px solid ${colors.glass.borderSubtle}`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Camp context - always show current location */}
            {selectedCamp && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    color: colors.accent.primary,
                    background: 'rgba(96, 165, 250, 0.15)',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  Day {selectedCamp.dayNumber}
                </span>
                <span style={{ color: colors.text.secondary }}>{selectedCamp.name}</span>
                <span
                  style={{
                    color: colors.text.tertiary,
                    background: 'rgba(255, 255, 255, 0.06)',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  {selectedCamp.elevation}m
                </span>
              </div>
            )}
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: colors.text.primary,
                textTransform: 'capitalize',
              }}
            >
              {activeTab === 'overview' ? 'Journey Info' : activeTab}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Edit toggle button */}
            <Button variant={editMode ? 'primary' : 'subtle'} size="icon" onClick={() => setEditMode(!editMode)}>
              <PencilIcon />
            </Button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: colors.text.tertiary,
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Edit Journey Details button */}
        {editMode && (
          <div style={{ padding: '0 16px 12px' }}>
            <Button variant="primary" size="md" onClick={() => setShowEditModal(true)} className="w-full">
              Edit Journey Details
            </Button>
          </div>
        )}

        {/* Content */}
        <div style={{ padding: 16, overflowY: 'auto', maxHeight: `calc(${maxHeight} - 60px)` }}>
          {activeTab === 'overview' && (
            <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load overview" />}>
              <OverviewTab trekData={trekData} />
            </ErrorBoundary>
          )}

          {activeTab === 'stats' && (
            <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load stats" />}>
              <StatsTab
                trekData={trekData}
                extendedStats={extendedStats}
                elevationProfile={elevationProfile}
                isMobile={isMobile}
                selectedCamp={selectedCamp}
                onCampSelect={onCampSelect}
              />
            </ErrorBoundary>
          )}

          {activeTab === 'photos' && (
            <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load photos" />}>
              <PhotosTab trekData={trekData} isMobile={isMobile} editMode={editMode} onViewPhotoOnMap={onPhotoClick} />
            </ErrorBoundary>
          )}

          {activeTab === 'journey' && (
            <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load journey" />}>
              <JourneyTab
                trekData={trekData}
                selectedCamp={selectedCamp}
                onCampSelect={onCampSelect}
                isMobile={isMobile}
                photos={photos}
                getMediaUrl={getMediaUrl}
                onUpdate={onJourneyUpdate}
                editMode={editMode}
                onViewPhotoOnMap={onPhotoClick}
              />
            </ErrorBoundary>
          )}
        </div>

        {/* Journey Edit Modal */}
        <JourneyEditModal
          slug={trekData.id}
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          onSave={() => {
            onJourneyUpdate();
            setShowEditModal(false);
          }}
          isMobile={isMobile}
        />
      </motion.div>
    </div>
  );
});

export default ContentCard;
