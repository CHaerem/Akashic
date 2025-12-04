# Adaptive Liquid Glass Navigation

## Problem Statement

The current InfoPanel design creates a **disconnect between map and content**:
- Bottom sheet covers significant map area when expanded
- Binary states (minimized vs expanded) feel jarring
- Map becomes "background" rather than the primary experience
- No natural synergy between photos and map markers

## Design Goals

1. **Map-first experience**: Keep the map visible and interactive at all times
2. **Contextual information**: Show relevant info based on map location/selection
3. **Adaptive controls**: Floating glass controls that expand on demand
4. **Photo-map integration**: Photos feel connected to their map locations

---

## Proposed Design: Floating Adaptive Navigation

### Core Concept

Replace the traditional bottom sheet with a **floating glass pill** that:
- Stays minimal by default (shows current context)
- Expands on tap to reveal navigation options
- Supports drag-to-select with magnification effect
- Can morph into content cards when needed

### Visual Hierarchy

```
┌─────────────────────────────────┐
│  [Akashic]                      │  ← Glass pill (top-left)
│                                 │
│           🏔️                    │
│      MAP CONTENT                │
│        📍 ← Photo markers       │
│                                 │
│                                 │
│                         ╭─────╮ │
│                         │Day 3│ │  ← Adaptive nav pill
│                         ╰─────╯ │
└─────────────────────────────────┘
```

---

## Component Design

### 1. AdaptiveNavPill (Collapsed State)

A floating glass pill in the bottom-right corner showing current context:

```
╭────────────╮
│  📅 Day 3  │
╰────────────╯
```

**Properties:**
- Position: `bottom: 24px, right: 16px` (above safe area)
- Size: ~80-100px width, 44px height (touch-friendly)
- Style: Liquid glass with blur, subtle border, shadow
- Content: Current day/location indicator

### 2. AdaptiveNavPill (Expanded State)

On tap, expands to show navigation options with magnification:

```
╭──────────────────────────────────────╮
│                                      │
│   📅      📍      📸      📊        │
│  Days    Map    Photos   Stats       │
│   ●                                  │  ← Selection indicator
╰──────────────────────────────────────╯
```

**Interactions:**
- Tap option → navigate to that mode
- Drag across → magnification follows finger, select on release
- Tap outside → collapse back to pill

### 3. Day Selector Mode

When "Days" is selected, pill morphs to show timeline:

```
╭──────────────────────────────────────╮
│   1    2   [3]   4    5    6    7   │
│            ↑ magnified              │
╰──────────────────────────────────────╯
```

**Interactions:**
- Drag to scrub through days
- Magnification effect on hovered day
- Release → jump to that day on map
- Photos from that day highlight on map

### 4. Photo Cluster Cards

When tapping a photo cluster on the map, show a **floating glass card** near the cluster:

```
        ╭─────────────────╮
        │  ┌───┬───┬───┐  │
        │  │ 📷│ 📷│ 📷│  │  ← Photo thumbnails
        │  └───┴───┴───┘  │
        │  Day 3 • Summit │
        ╰─────────────────╯
             ▼
           📍 (cluster marker)
```

This keeps photos connected to their map location rather than pulling them into a separate panel.

---

## Implementation Approach

### Phase 1: Adaptive Nav Pill

Create the core floating navigation component:

```typescript
// New components
src/components/nav/
├── AdaptiveNavPill.tsx      // Main container with expand/collapse
├── NavOption.tsx            // Individual nav option with magnification
├── DayTimeline.tsx          // Day selector timeline
└── useMagnification.ts      // Hook for magnification effect
```

**Key Features:**
- CSS `scale()` transforms for magnification
- `touch-action: none` for custom gesture handling
- `backdrop-filter: blur()` for glass effect
- Spring animations for smooth transitions

### Phase 2: Photo Integration

Replace panel-based photo viewing with map-integrated cards:

```typescript
src/components/map/
├── PhotoClusterCard.tsx     // Floating card near cluster
├── PhotoMarkerPopup.tsx     // Single photo popup
└── usePhotoSelection.ts     // Track selected photos/clusters
```

### Phase 3: Contextual Content

Add smart content display based on map interaction:

- Tap camp marker → show camp info card near marker
- Tap route segment → show segment stats inline
- Tap photo cluster → show photo preview card
- Pinch to zoom out → show journey overview

---

## Technical Considerations

### PWA Feasibility

| Effect | Implementation | Feasibility |
|--------|---------------|-------------|
| Glass blur | `backdrop-filter: blur(20px)` | ✅ Excellent |
| Magnification | CSS `scale()` + spring animation | ✅ Excellent |
| Drag selection | Touch events + position tracking | ✅ Excellent |
| Haptic feedback | `navigator.vibrate()` | 🟡 Basic only |
| 60fps animations | `transform` + `will-change` | ✅ Excellent |

### Performance Notes

- Use `transform` and `opacity` only for animations (GPU accelerated)
- Minimize DOM updates during drag (use refs for position)
- Debounce map interactions during nav pill animation
- Consider `useDeferredValue` for photo updates

---

## Design Questions to Resolve

1. **Info depth**: How much detail should floating cards show vs needing a full panel?
   - Option A: Cards show preview, tap for full panel
   - Option B: Cards expand in place for more detail
   - Option C: Hybrid - basic info in cards, "See more" opens panel

2. **Desktop adaptation**: How should this work on desktop?
   - Option A: Same floating pill (bottom-right)
   - Option B: Keep side panel for desktop, pill for mobile only
   - Option C: Horizontal toolbar at bottom

3. **Journey tab content**: The current Journey tab has rich day-by-day content. Where does this live?
   - Option A: Day cards that expand inline
   - Option B: Full-screen overlay when a day is selected
   - Option C: Keep a minimal panel for long-form content

4. **Stats/Overview content**: Where do detailed stats and overview text go?
   - Option A: Expandable cards from the nav pill
   - Option B: Swipe up from nav pill to reveal sheet
   - Option C: Dedicated "Info" mode with larger overlay

---

## Next Steps

1. **Get Viaplay screenshots** to confirm exact interaction pattern
2. **Prototype the nav pill** with basic expand/collapse
3. **Test magnification effect** on real devices
4. **User test** with your mom to validate the approach before full implementation

---

## Reference: Viaplay Pattern (To Be Updated)

*Awaiting screenshots to document the exact interaction pattern*

Expected features:
- Collapsed pill with icon indicators
- Expand on tap/hold
- Magnification effect on drag
- Smooth spring animations
