# Intelligent Route Drawing System

## Overview

Add an intelligent drawing mode to the Route Editor that:
1. Automatically snaps to trails when drawing near mapped paths
2. Falls back to freehand drawing when no trails exist
3. Auto-simplifies points to maintain performance
4. Works seamlessly on both desktop and mobile

## Design Principles

- **Invisible intelligence**: The system should help without requiring the user to think about modes or settings
- **Single gesture**: One interaction pattern works everywhere (draw by dragging)
- **Graceful degradation**: When snapping fails, freehand still works
- **Mobile-first**: Touch interactions are primary, mouse is secondary

---

## Implementation Plan

### Phase 1: Drawing Mode Foundation

**Goal**: Add basic drawing mode with touch/mouse support

#### 1.1 Add Draw Mode to Route Editor

Add a third editing mode: "Draw" (alongside existing "Edit Points")

```
Route Mode Options:
- Edit Points (current behavior - drag existing markers)
- Draw (new - draw new route sections)
```

**UI Changes:**
- Add "Draw" toggle button in Route mode
- Show different instructions based on sub-mode
- Visual indicator when in draw mode (cursor change, overlay hint)

#### 1.2 Implement Drawing Gesture Handler

**Desktop (Mouse):**
- `mousedown` on map → start drawing
- `mousemove` while pressed → collect points
- `mouseup` → finish segment and process

**Mobile (Touch):**
- Single finger touch + drag → draw
- Two-finger gesture → pan/zoom map (preserved)
- Lift finger → finish segment and process

**Key Implementation:**
```typescript
// Track drawing state
const [isDrawing, setIsDrawing] = useState(false);
const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);

// Drawing event handlers
const handleDrawStart = (coords: [number, number]) => {
  setIsDrawing(true);
  setDrawingPoints([coords]);
};

const handleDrawMove = (coords: [number, number]) => {
  if (!isDrawing) return;
  // Add point if sufficient distance from last point (5-10m min)
  setDrawingPoints(prev => [...prev, coords]);
};

const handleDrawEnd = () => {
  setIsDrawing(false);
  processDrawnSegment(drawingPoints);
};
```

#### 1.3 Real-time Drawing Preview

Show the drawn line in real-time as user drags:
- Add temporary "drawing-preview" GeoJSON source
- Update on each move event
- Style with dashed line or different color
- Remove preview after processing

---

### Phase 2: Intelligent Processing

**Goal**: Auto-detect whether to snap to trails or use freehand

#### 2.1 Trail Snapping with Map Matching API

When drawing segment finishes:

```typescript
async function processDrawnSegment(points: [number, number][]) {
  // 1. Sample points (max 100 for API)
  const sampled = samplePoints(points, 100);

  // 2. Try Map Matching API
  const matchResult = await tryMapMatching(sampled);

  // 3. Decide based on confidence
  if (matchResult && matchResult.confidence > 0.7) {
    // Use snapped route
    mergeSnappedRoute(matchResult.coordinates);
    showFeedback('Snapped to trail');
  } else {
    // Use simplified freehand
    const simplified = douglasPeucker(points, tolerance);
    mergeFreehandRoute(simplified);
  }
}
```

**Map Matching API Call:**
```typescript
async function tryMapMatching(coords: [number, number][]): Promise<MatchResult | null> {
  const coordString = coords.map(c => `${c[0]},${c[1]}`).join(';');

  const response = await fetch(
    `https://api.mapbox.com/matching/v5/mapbox/walking/${coordString}?` +
    `access_token=${mapboxToken}&` +
    `geometries=geojson&` +
    `radiuses=${coords.map(() => '25').join(';')}&` + // 25m snap radius
    `tidy=true`
  );

  const data = await response.json();

  if (data.code === 'Ok' && data.matchings?.length > 0) {
    return {
      coordinates: data.matchings[0].geometry.coordinates,
      confidence: data.matchings[0].confidence
    };
  }
  return null;
}
```

#### 2.2 Douglas-Peucker Simplification

For freehand routes, reduce point count while maintaining shape:

```typescript
function douglasPeucker(
  points: [number, number][],
  epsilon: number
): [number, number][] {
  if (points.length <= 2) return points;

  // Find point with max perpendicular distance
  let maxDist = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance > epsilon, recursively simplify
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}
```

**Adaptive Tolerance:**
- Snapped routes: minimal simplification (trails are already optimal)
- Freehand routes: ~10-20m tolerance (removes GPS jitter, keeps shape)
- User can adjust via zoom level (more zoomed = more detail preserved)

#### 2.3 Segment Merging

When a drawn segment is processed, merge it with existing route:

**Append Mode (default):**
- Add new points to end of route
- Connect last route point to first drawn point

**Insert Mode:**
- If drawing starts near an existing route point, insert there
- Replace the segment between nearest start and end points

**Connect Mode:**
- If drawing connects two separate route sections, join them

---

### Phase 3: Visual Feedback & Polish

#### 3.1 Drawing Feedback

- **During drawing**: Dashed preview line follows finger/cursor
- **Processing**: Brief loading indicator
- **Snapped**: Green flash/pulse + "Snapped to trail" toast
- **Freehand**: Blue flash + point count "Added 15 points"

#### 3.2 Instructions Overlay

Dynamic instructions based on state:
```
Draw mode (idle): "Draw on map to add route"
Draw mode (drawing): "Lift to finish segment"
Processing: "Processing..."
After snap: "Snapped to [Trail Name]" (if available)
```

#### 3.3 Mobile-Specific Enhancements

- Larger touch target for mode toggle
- Haptic feedback on snap (if available)
- Prevent accidental draws on pan (require ~50ms hold before draw starts)
- Show finger position indicator while drawing

---

### Phase 4: Edge Cases & Robustness

#### 4.1 Handle API Failures

```typescript
async function processDrawnSegment(points) {
  try {
    const matchResult = await tryMapMatching(sampled);
    // ... use result
  } catch (error) {
    // API failed - fall back to freehand silently
    console.warn('Map matching failed, using freehand:', error);
    const simplified = douglasPeucker(points, tolerance);
    mergeFreehandRoute(simplified);
  }
}
```

#### 4.2 Rate Limiting

- Debounce rapid draw attempts
- Queue requests if hitting rate limit
- Cache recent match results for similar areas

#### 4.3 Elevation Data

For snapped routes, elevation comes from the matched geometry.
For freehand routes, interpolate from nearby points or query terrain.

---

## File Changes

| File | Changes |
|------|---------|
| `src/components/trek/RouteEditor.tsx` | Add draw mode, gesture handlers, preview layer |
| `src/utils/routeUtils.ts` | Add `douglasPeucker()`, `samplePoints()`, `mergeRouteSegment()` |
| `src/lib/mapbox.ts` (new) | Map Matching API wrapper with caching |

---

## Testing Strategy

1. **Unit tests** for Douglas-Peucker algorithm
2. **E2E tests** for draw mode toggle and basic drawing
3. **Manual testing** on mobile devices for gesture handling
4. **API mocking** for Map Matching in tests

---

## Rollout Plan

1. **Phase 1** (Foundation): Drawing mode with freehand only
2. **Phase 2** (Intelligence): Add Map Matching integration
3. **Phase 3** (Polish): Visual feedback and mobile refinements
4. **Phase 4** (Robustness): Error handling and edge cases

Each phase can be shipped incrementally - Phase 1 alone provides value.

---

## Open Questions

1. **Extend vs Replace**: Should drawing extend the route from endpoints, or allow drawing anywhere with auto-connect?
   - Recommendation: Start with extend-only (simpler), add insert later

2. **Snap radius**: How far from a trail should we attempt snapping?
   - Recommendation: 25m default, could expose as setting later

3. **Cost management**: Map Matching API has costs - should we limit usage?
   - Recommendation: Only call API for segments > 50m, cache results

---

## Summary

This plan adds intelligent route drawing in 4 phases:
1. Basic drawing gesture support (immediate value)
2. Trail snapping when available (smart assistance)
3. Visual polish and mobile optimization (great UX)
4. Robustness and edge cases (production ready)

The key insight is that the system should be invisible - users just draw, and it does the right thing automatically.
