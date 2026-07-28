/**
 * Structural types for the slice of MapKit JS this adapter uses. (MAP-03)
 *
 * ## Why hand-written and not a package
 *
 * MapKit JS is **not on npm**. It arrives as a global from a `<script>` tag pointing at
 * `cdn.apple-mapkit.com`, and Apple publishes no types for it. So there is nothing to install, nothing for
 * `src/lib/map/boundary.test.ts`'s import regexes to catch (which is why that test now also bans the
 * *global* — see the note there), and no way to get the shapes below except by writing them.
 *
 * Deliberately **structural and minimal**: every member here is one this adapter actually calls, and every
 * one was exercised against a real rendered map by `scripts/mapkit/surface-probe/`. A wider type would be
 * a list of things we believe rather than things we measured.
 *
 * Two hazards these types are shaped around, both measured:
 *
 * - `mapkit.Coordinate` is `(latitude, longitude)` — **the opposite order from `LngLat`**, which is
 *   `[lng, lat]` everywhere else in this repo. The conversion lives in exactly one place
 *   (`./coords.ts`) and nothing else in the adapter is allowed to construct a coordinate.
 * - **The minified bundle makes `constructor.name` useless** — a `Coordinate` reports `ot`, a
 *   `MarkerAnnotation` reports `Uf`. Use `instanceof` if you ever need a runtime check, never the name.
 *
 * Also: `Object.getOwnPropertyNames(mapkit)` returns an **empty array**, so feature-detect with `in`.
 */

/** A MapKit coordinate. LATITUDE FIRST — see the header. */
export interface MKCoordinate {
    latitude: number;
    longitude: number;
    copy(): MKCoordinate;
}

export interface MKCoordinateSpan {
    latitudeDelta: number;
    longitudeDelta: number;
}

export interface MKCoordinateRegion {
    center: MKCoordinate;
    span: MKCoordinateSpan;
    toBoundingRegion(): MKBoundingRegion;
}

export interface MKBoundingRegion {
    northLatitude: number;
    eastLongitude: number;
    southLatitude: number;
    westLongitude: number;
}

export interface MKPadding {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/**
 * The complete settable set of `mapkit.Style` is 13 keys; any other key logs
 * `[MapKit] Style has no property named …` and is dropped. Only the ones this adapter uses are declared.
 *
 * `lineGradient` is deliberately ABSENT. It is accepted by the API, reads back truthy, raises no warning —
 * and paints nothing, while *suppressing* the stroke, so a route that also set `strokeColor` renders as
 * nothing at all. Measured; see `scripts/mapkit/surface-probe/index.html` (P-HALO). Leaving it off the type
 * is the cheapest way to stop someone reaching for it.
 *
 * `strokeStart`/`strokeEnd` are fractions of **arc length**, not of point index — measured (P-M2) on a
 * 3-point line with a 10:1 leg ratio, which is the only geometry that distinguishes them.
 */
export interface MKStyleOptions {
    strokeColor?: string;
    strokeOpacity?: number;
    lineWidth?: number;
    lineCap?: 'butt' | 'round' | 'square';
    lineJoin?: 'miter' | 'round' | 'bevel';
    strokeStart?: number;
    strokeEnd?: number;
}

export interface MKStyle extends MKStyleOptions {
    strokeStart: number;
    strokeEnd: number;
}

export interface MKPolylineOverlay {
    points: MKCoordinate[];
    style: MKStyle;
}

/** What `new mapkit.Annotation(coord, factory, options)` takes. */
export interface MKAnnotationOptions {
    /** REQUIRED in practice: MapKit hit-tests against it. */
    size?: { width: number; height: number };
    /**
     * Measured DOWNWARD-NEGATIVE, and the default is bottom-anchored like a pin: for a 36 px element,
     * `(0, 0)` puts the element's rect centre 18 px ABOVE the coordinate and `(0, -18)` centres it.
     * See `centringAnchorOffset` in `./annotations.ts`.
     */
    anchorOffset?: DOMPoint;
    data?: unknown;
    draggable?: boolean;
    calloutEnabled?: boolean;
    collisionMode?: string;
    displayPriority?: number;
}

export interface MKAnnotation {
    coordinate: MKCoordinate;
    data: unknown;
    draggable: boolean;
    /**
     * LIVE-MUTABLE on an annotation already on the map — measured (QUA-49): assigning it moved the marker and
     * its hit region with no re-add. Same downward-negative convention as
     * {@link MKAnnotationOptions.anchorOffset}, which is where it was declared ALONE until QUA-58; before that
     * `setAnchorOffset` in `./annotations.ts` reached the property through a local intersection cast, because a
     * type shared by the whole adapter was not QUA-49's to move.
     *
     * Optional, and deliberately not narrowed: what MapKit reports when the options omit it is UNMEASURED —
     * this adapter always passes one — so declaring it required would assert something nobody has seen.
     */
    anchorOffset?: DOMPoint;
    element?: HTMLElement;
    addEventListener(name: string, handler: (event: unknown) => void): void;
}

export interface MKMap {
    mapType: string;
    colorScheme: string;
    center: MKCoordinate;
    region: MKCoordinateRegion;
    rotation: number;
    cameraDistance: number;
    padding: MKPadding;
    overlays: MKPolylineOverlay[];
    annotations: MKAnnotation[];
    isRotationEnabled: boolean;
    isScrollEnabled: boolean;
    isZoomEnabled: boolean;
    showsPointsOfInterest: boolean;
    setRegionAnimated(region: MKCoordinateRegion, animate: boolean): void;
    addOverlay(overlay: MKPolylineOverlay): void;
    removeOverlay(overlay: MKPolylineOverlay): void;
    addAnnotation(annotation: MKAnnotation): void;
    removeAnnotation(annotation: MKAnnotation): void;
    convertCoordinateToPointOnPage(coordinate: MKCoordinate): DOMPoint;
    convertPointOnPageToCoordinate(point: DOMPoint): MKCoordinate;
    addEventListener(name: string, handler: (event: unknown) => void): void;
    removeEventListener(name: string, handler: (event: unknown) => void): void;
    destroy(): void;
    /**
     * There is NO `stop()` and no `cancelAnimation()` — measured, both `undefined`. Declared here as
     * optional so a future MapKit version that adds one can be feature-detected rather than assumed, and so
     * that reading this type tells you the interruption problem is real. `./useMapKitJourney.ts` coalesces
     * camera requests instead; see the comment there.
     */
    stop?: () => void;
}

/** Options accepted by `new mapkit.Map(element, options)` — the subset the adapter sets. */
export interface MKMapOptions {
    mapType?: string;
    colorScheme?: string;
    showsMapTypeControl?: boolean;
    showsZoomControl?: boolean;
    showsUserLocationControl?: boolean;
    showsCompass?: string;
    showsScale?: string;
    showsPointsOfInterest?: boolean;
    isRotationEnabled?: boolean;
    padding?: MKPadding;
}

/** The `mapkit` global. */
export interface MapKitNamespace {
    version: string;
    build: string;
    maps: MKMap[];
    init(options: { authorizationCallback: (done: (token: string) => void) => void }): void;
    addEventListener(name: string, handler: (event: { status: string }) => void): void;
    Map: {
        new(element: HTMLElement | string, options?: MKMapOptions): MKMap;
        MapTypes: { Satellite: string; Hybrid: string; Standard: string; MutedStandard: string };
        ColorSchemes: { Dark: string; Light: string; Adaptive: string };
    };
    Coordinate: new (latitude: number, longitude: number) => MKCoordinate;
    CoordinateSpan: new (latitudeDelta: number, longitudeDelta: number) => MKCoordinateSpan;
    CoordinateRegion: new (center: MKCoordinate, span: MKCoordinateSpan) => MKCoordinateRegion;
    BoundingRegion: new (north: number, east: number, south: number, west: number) => MKBoundingRegion;
    Padding: new (options: Partial<MKPadding>) => MKPadding;
    Style: new (options: MKStyleOptions) => MKStyle;
    PolylineOverlay: new (points: MKCoordinate[], options: { style: MKStyle }) => MKPolylineOverlay;
    Annotation: {
        new(
            coordinate: MKCoordinate,
            factory: (coordinate: MKCoordinate, options: unknown) => HTMLElement,
            options?: MKAnnotationOptions,
        ): MKAnnotation;
        CollisionMode: { Rectangle: string; Circle: string; None: string };
        /** Measured: Low 250, High 750, Required 1000. */
        DisplayPriority: { Low: number; High: number; Required: number };
    };
    FeatureVisibility: { Adaptive: string; Hidden: string; Visible: string };
}

declare global {
    interface Window {
        mapkit?: MapKitNamespace;
    }
}
