/**
 * Context Card component for displaying day information
 * Shows when the navigation pill is tapped
 */

import { memo, type RefObject } from 'react';
import { motion } from 'framer-motion';
import { colors, radius, effects } from '../../styles/liquidGlass';
import type { Camp, TabType, Photo } from '../../types/trek';
import { CloseIcon, PhotoIcon, InfoIcon } from '../icons';

const SPRING_CONFIG = {
  mass: 0.1,
  stiffness: 200,
  damping: 15,
};

interface ContextCardProps {
  currentCamp: Camp;
  currentDay: number;
  currentDayDate: Date | null;
  dayPhotos: Photo[];
  getMediaUrl: (path: string) => string;
  onClose: () => void;
  onOpenContent: (tab: TabType) => void;
  onOpenDayGallery: () => void;
  isMobile: boolean;
  contextRef: RefObject<HTMLDivElement | null>;
}

export const ContextCard = memo(function ContextCard({
  currentCamp,
  currentDay,
  currentDayDate,
  dayPhotos,
  getMediaUrl,
  onClose,
  onOpenContent,
  onOpenDayGallery,
  isMobile,
  contextRef,
}: ContextCardProps) {
  return (
    <motion.div
      ref={contextRef}
      key="context-card"
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ type: 'spring', ...SPRING_CONFIG }}
      style={{
        background: `linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)`,
        backdropFilter: `${effects.blur.intense} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.intense} ${effects.saturation.enhanced}`,
        border: `1px solid ${colors.glass.border}`,
        boxShadow: `0 16px 48px rgba(0, 0, 0, 0.3)`,
        borderRadius: radius.xl,
        padding: 16,
        width: isMobile ? 'calc(100vw - 48px)' : 340,
        maxWidth: 380,
        maxHeight: isMobile ? 'calc(60vh - env(safe-area-inset-bottom))' : '50vh',
        overflowY: 'auto',
      }}
    >
      {/* Header with close button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: colors.accent.primary,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                background: 'rgba(96, 165, 250, 0.15)',
                padding: '3px 8px',
                borderRadius: 6,
              }}
            >
              Day {currentCamp.dayNumber}
            </span>
            {currentDayDate && (
              <span style={{ fontSize: 12, color: colors.text.tertiary }}>
                {currentDayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
            <span
              style={{
                fontSize: 12,
                color: colors.text.secondary,
                background: 'rgba(255, 255, 255, 0.08)',
                padding: '2px 8px',
                borderRadius: 4,
              }}
            >
              {currentCamp.elevation}m
            </span>
          </div>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: colors.text.primary,
              margin: 0,
            }}
          >
            {currentCamp.name}
          </h3>
        </div>
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
          <CloseIcon size={16} />
        </button>
      </div>

      {/* Notes - show full description */}
      {currentCamp.notes && (
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: colors.text.secondary,
            margin: 0,
            marginBottom: 12,
          }}
        >
          {currentCamp.notes}
        </p>
      )}

      {/* Photo strip - tap to open day gallery */}
      {dayPhotos.length > 0 && (
        <motion.div
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={onOpenDayGallery}
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 4,
            WebkitOverflowScrolling: 'touch',
            cursor: 'pointer',
            padding: 8,
            margin: '-8px -8px 4px -8px',
            borderRadius: radius.md,
            background: 'rgba(255, 255, 255, 0.03)',
          }}
        >
          {dayPhotos.slice(0, 5).map((photo, idx) => (
            <div
              key={photo.id}
              style={{
                flexShrink: 0,
                width: 56,
                height: 56,
                borderRadius: radius.md,
                overflow: 'hidden',
                border: `1px solid ${colors.glass.borderSubtle}`,
              }}
            >
              <img
                src={getMediaUrl(photo.url)}
                alt={photo.caption || `Photo ${idx + 1}`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            </div>
          ))}
          {dayPhotos.length > 5 && (
            <div
              style={{
                flexShrink: 0,
                width: 56,
                height: 56,
                borderRadius: radius.md,
                background: 'rgba(255, 255, 255, 0.08)',
                border: `1px solid ${colors.glass.borderSubtle}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: colors.text.secondary,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              +{dayPhotos.length - 5}
            </div>
          )}
        </motion.div>
      )}

      {/* Highlights */}
      {currentCamp.highlights && currentCamp.highlights.length > 0 && (
        <ul
          style={{
            margin: 0,
            marginBottom: 12,
            paddingLeft: 16,
          }}
        >
          {currentCamp.highlights.slice(0, 3).map((highlight, idx) => (
            <li
              key={idx}
              style={{
                fontSize: 12,
                color: colors.text.secondary,
                marginBottom: 2,
              }}
            >
              {highlight}
            </li>
          ))}
        </ul>
      )}

      {/* Action buttons */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {dayPhotos.length > 0 && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onOpenDayGallery}
            style={{
              flex: '1 1 100%',
              padding: '10px 12px',
              background: 'rgba(96, 165, 250, 0.15)',
              border: 'none',
              borderRadius: radius.md,
              cursor: 'pointer',
              color: colors.accent.primary,
              fontSize: 12,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              marginBottom: 4,
            }}
          >
            <PhotoIcon size={14} />
            View Day {currentDay} Photos ({dayPhotos.length})
          </motion.button>
        )}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onOpenContent('photos')}
          style={{
            flex: 1,
            padding: '10px 12px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            borderRadius: radius.md,
            cursor: 'pointer',
            color: colors.text.secondary,
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <PhotoIcon size={14} />
          All Photos
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onOpenContent('overview')}
          style={{
            flex: 1,
            padding: '10px 12px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            borderRadius: radius.md,
            cursor: 'pointer',
            color: colors.text.secondary,
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <InfoIcon size={14} />
          Journey Info
        </motion.button>
      </div>
    </motion.div>
  );
});

export default ContextCard;
