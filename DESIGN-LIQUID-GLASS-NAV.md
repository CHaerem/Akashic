# Adaptive Liquid Glass Navigation

## Status: ✅ Implemented

This design has been fully implemented in `src/components/nav/AdaptiveNavPill.tsx`.

---

## Overview

The navigation uses a **floating glass pill** inspired by macOS dock magnification and Viaplay's drag-to-select interface. It replaces the traditional bottom sheet with a minimal, map-first navigation system.

### Key Features

- **Collapsed state**: Shows current day/camp as a minimal pill
- **Expanded state**: Reveals nav options (Days, Info, Photos, Stats) with magnification
- **Day selector**: Scrub through days with dock-style magnification
- **Content cards**: Glass morphism floating cards for rich content
- **Interactive elevation profile**: Click/tap camp markers to navigate

---

## Component Structure

```
src/components/nav/
└── AdaptiveNavPill.tsx     # Main component with all states
```

### Internal Components

| Component | Purpose |
|-----------|---------|
| `DockItem` | Nav option with magnification effect |
| `DayItem` | Day number with magnification effect |
| `ContentCard` | Floating glass card for tab content |

---

## States & Modes

```typescript
type NavMode = 'collapsed' | 'expanded' | 'days' | 'content';
```

### 1. Collapsed (Default)

```
╭────────────────────╮
│  📅 Day 3 • Namche │
╰────────────────────╯
```

Shows current context. Tap to expand.

### 2. Expanded

```
╭──────────────────────────────────────╮
│   📅      📍      📸      📊        │
│  Days    Info   Photos   Stats       │
╰──────────────────────────────────────╯
```

Drag across for magnification effect. Release to select.

### 3. Days (Day Selector)

```
╭──────────────────────────────────────╮
│  ←   1    2   [3]   4    5    6    7 │
│              ↑ magnified             │
╰──────────────────────────────────────╯
```

Drag to scrub through days. Release to select and fly to that camp.

### 4. Content (Card Visible)

A floating glass card appears centered on screen with the selected tab's content:

- **Overview**: Trek name, description, key stats
- **Stats**: Interactive elevation profile, journey stats, historical sites
- **Journey**: Day-by-day breakdown with segments, photos
- **Photos**: Photo gallery with lightbox

---

## Interactions

### Drag-to-Select (Viaplay Style)

1. Touch down on pill → start tracking pointer
2. Move finger → magnification follows, hover state updates
3. Release → select hovered item

### Magnification Effect

Uses `useTransform` from framer-motion:

```typescript
const distance = useTransform(mouseX, (val) => {
  const bounds = ref.current?.getBoundingClientRect();
  return val - bounds.x - bounds.width / 2;
});

const scale = useTransform(
  distance,
  [-MAGNIFICATION.distance, 0, MAGNIFICATION.distance],
  [1, MAGNIFICATION.scale, 1]
);
```

### Click Outside Handling

The component tracks two refs:
- `pillRef` - The navigation pill
- `cardRef` - The content card

Clicking outside both closes the nav back to collapsed state.

---

## Content Integration

The ContentCard renders the existing tab components:

```typescript
{activeTab === 'stats' && (
  <StatsTab
    trekData={trekData}
    extendedStats={extendedStats}
    elevationProfile={elevationProfile}
    selectedCamp={selectedCamp}
    onCampSelect={onCampSelect}
  />
)}
```

### Tab Components Used

| Tab | Component | Features |
|-----|-----------|----------|
| Overview | `OverviewTab` | Description, basic stats |
| Stats | `StatsTab` | Interactive elevation profile, journey stats, historical sites |
| Journey | `JourneyTab` | Day-by-day with segments, photos per day |
| Photos | `PhotosTab` | Photo grid, lightbox, upload (edit mode) |

---

## Styling

Uses the liquid glass design system from `src/styles/liquidGlass.ts`:

```typescript
const glassStyle = {
  background: 'linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.07) 100%)',
  backdropFilter: 'blur(20px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.2)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)',
};
```

---

## Mobile Considerations

- **Safe areas**: Pill positioned above `env(safe-area-inset-bottom)`
- **Touch targets**: Minimum 44px for all interactive elements
- **Card height**: Limited to avoid overlap with pill
- **Touch events**: Proper `touch-action: none` for drag handling

---

## Future Improvements

1. **Photo map integration**: Show photo cluster cards near map markers
2. **Haptic feedback**: Vibrate on day selection (where supported)
3. **Gesture shortcuts**: Swipe up from collapsed to expand
4. **Camp previews**: Show camp info on elevation profile hover

---

## Related Files

- `src/components/nav/AdaptiveNavPill.tsx` - Main component
- `src/components/trek/StatsTab.tsx` - Stats with elevation profile
- `src/components/trek/JourneyTab.tsx` - Journey day breakdown
- `src/components/trek/OverviewTab.tsx` - Overview content
- `src/components/trek/PhotosTab.tsx` - Photo gallery
- `src/styles/liquidGlass.ts` - Glass design tokens
