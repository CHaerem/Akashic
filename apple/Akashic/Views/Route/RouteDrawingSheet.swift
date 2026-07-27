import SwiftUI
import MapKit

/// Draw a route with a finger — the route source for journeys that never had a GPX and whose photos
/// carry no GPS (§4.1's "draw on map" fallback; COMMERCIALIZATION-PLAN §11 phase 5).
///
/// Interaction is an explicit **two-mode** map rather than clever gesture arbitration: in *Draw* the
/// map is frozen and a drag traces the route; in *Move map* the map pans and zooms normally and no
/// drawing happens. One finger always means the same thing in a given mode, which is what makes it
/// usable on a phone — a drag that sometimes pans and sometimes draws is the failure mode this
/// avoids.
///
/// The view owns only the gesture and the camera. Which samples survive, how each stroke attaches to
/// what is already drawn, and the final polyline all come from `RouteDrawing` (pure, unit-tested).
/// Strokes are kept individually so **Undo** is exact: drop the last stroke and refold. The fold is
/// cached in `drawn` rather than recomputed per body evaluation — body runs on every captured sample.
///
/// Elevation is deliberately absent (`RouteDrawing.elevationNote`) — the note is on screen before
/// the user commits, never discovered afterwards in wrong stats.
struct RouteDrawingSheet: View {
    @Environment(\.dismiss) private var dismiss

    var title: LocalizedStringKey = "Draw route"
    /// The journey's current route, drawn dashed underneath as a reference when replacing.
    var referenceRoute: Route?
    /// Where to open when there is no reference route — the region framing the days/photos we know
    /// about. Nil opens on a wide view the user can pan from.
    var fallbackRegion: MKCoordinateRegion?
    /// Called with the finished drawing on Done, carrying its own provenance (bridged gaps). Never
    /// called with fewer than two points.
    var onDone: (RouteDrawing.DrawnRoute) -> Void

    private enum Mode { case draw, pan }

    @State private var mode: Mode = .draw
    /// Committed strokes, each already simplified. The source of truth for what has been drawn.
    @State private var strokes: [[[Double]]] = []
    /// The stroke currently under the finger.
    @State private var current: [[Double]] = []
    /// Cached fold of `strokes` — refreshed only where `strokes` changes (commit / undo / clear).
    @State private var drawn = Drawn()
    @State private var camera: MapCameraPosition = .automatic
    /// The reference route's MapKit coordinates, projected once instead of per body evaluation.
    @State private var referenceCoordinates: [CLLocationCoordinate2D] = []

    /// Everything the view needs about the committed strokes, computed once per change.
    private struct Drawn {
        var result = RouteDrawing.DrawnRoute(route: .empty, bridgedGaps: 0)
        var coordinates: [CLLocationCoordinate2D] = []
        /// Resolved through the catalogue rather than a bare literal: the other values this
        /// field takes are formatted measurements from `RouteDrawing.DrawnRoute.summary`, so
        /// it stays a `String` and only the placeholder needs translating.
        var summary: String = String(localized: "Nothing drawn yet",
                                    comment: "Route drawing sheet: shown before the first stroke.")
    }

    var body: some View {
        NavigationStack {
            ZStack {
                map
                VStack(spacing: 0) {
                    if strokes.isEmpty && current.isEmpty { hint }
                    Spacer()
                    controls
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.tint(Theme.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onDone(drawn.result)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .tint(Theme.accent)
                    .disabled(!drawn.result.isUsable)
                }
            }
            .onAppear(perform: prepare)
        }
    }

    // MARK: Map

    private var map: some View {
        MapReader { proxy in
            ZStack {
                Map(position: $camera, interactionModes: mode == .pan ? .all : []) {
                    if referenceCoordinates.count > 1 {
                        MapPolyline(coordinates: referenceCoordinates)
                            .stroke(Theme.textTertiary,
                                    style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [4, 4]))
                    }
                    if drawn.coordinates.count > 1 {
                        MapPolyline(coordinates: drawn.coordinates)
                            .stroke(Theme.accent,
                                    style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                    }
                    if current.count > 1 {
                        MapPolyline(coordinates: current.clCoordinates)
                            .stroke(Theme.accent.opacity(0.7),
                                    style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [6, 5]))
                    }
                }
                .mapStyle(.standard(elevation: .flat))
                .ignoresSafeArea(edges: .bottom)

                // Drawing surface. Only present in .draw mode, where the map itself takes no
                // gestures — so a drag can never mean two things at once.
                if mode == .draw {
                    Color.clear
                        .contentShape(Rectangle())
                        .gesture(drawGesture(proxy))
                        // QUA-24, stated rather than papered over: tracing a route with a finger is
                        // direct manipulation of a continuous surface, and no label makes that
                        // operable with VoiceOver — there is no discrete control here to name. What
                        // this element can honestly do is say what the surface is and where the
                        // alternatives are, so it is not encountered as an unexplained dead zone.
                        // Every route this sheet produces is also reachable through Import GPX and
                        // Draft route from photos, both of which are ordinary buttons.
                        .accessibilityLabel("Drawing surface")
                        .accessibilityHint("Tracing a route needs sight and a finger. To set a route without drawing, close this and use Import GPX or Draft route from photos.")
                }
            }
        }
    }

    private func drawGesture(_ proxy: MapProxy) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                guard let coordinate = proxy.convert(value.location, from: .local) else { return }
                let point = [coordinate.longitude, coordinate.latitude]
                if RouteDrawing.shouldAppend(point, to: current) {
                    current.append(point)
                }
            }
            .onEnded { _ in commitStroke() }
    }

    /// Simplify and keep the finished stroke. A tap (one sample) is not a leg and is discarded.
    private func commitStroke() {
        let simplified = RouteDrawing.simplify(current)
        current = []
        guard simplified.count >= 2 else { return }
        strokes.append(simplified)
        refold()
    }

    /// The only place the cache is built, so it cannot drift from `strokes`.
    private func refold() {
        let result = RouteDrawing.drawnRoute(strokes: strokes)
        drawn = Drawn(result: result,
                      coordinates: result.route.clCoordinates,
                      // `String(localized:)`, matching `Drawn`'s own default. This branch had a bare
                      // literal, so the placeholder was correctly translated when the sheet opened
                      // and reverted to English the moment the user drew a stroke and undid it —
                      // exactly the QUA-06 trap, in the one spot where the two forms sat side by side.
                      summary: result.isUsable
                          ? result.summary
                          : String(localized: "Nothing drawn yet",
                                   comment: "Route drawing sheet: shown before the first stroke."))
    }

    // MARK: Overlays

    private var hint: some View {
        Text(mode == .draw ? "Trace the route with one finger" : "Pan and zoom, then switch to Draw")
            .font(.footnote)
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .themedMaterial(Capsule())
            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
            .padding(.top, 12)
    }

    private var controls: some View {
        VStack(spacing: 10) {
            Picker("Mode", selection: $mode) {
                Label("Draw", systemImage: "scribble").tag(Mode.draw)
                Label("Move map", systemImage: "hand.draw").tag(Mode.pan)
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Map mode")

            HStack(spacing: 10) {
                Text(drawn.summary)
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    // The only running statement of what has been drawn — and the two buttons beside
                    // it are what change it, so it needs to read as a labelled state, not a fragment.
                    .accessibilityLabel("Drawn so far")
                    .accessibilityValue(drawn.summary)
                Button {
                    strokes.removeLast()
                    refold()
                } label: {
                    Image(systemName: "arrow.uturn.backward")
                }
                .disabled(strokes.isEmpty)
                .accessibilityLabel("Undo the last stroke")
                Button {
                    strokes = []
                    current = []
                    refold()
                } label: {
                    Image(systemName: "trash")
                }
                .disabled(strokes.isEmpty)
                .accessibilityLabel("Clear everything drawn")
            }
            .font(.subheadline.weight(.semibold))
            .tint(Theme.accent)

            Text(RouteDrawing.elevationNote)
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .themedMaterial(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
    }

    // MARK: Setup

    /// Project the reference route once and pin the camera before the user can draw.
    ///
    /// Pinning is load-bearing, not cosmetic: `.automatic` re-frames itself to fit the map's content,
    /// and the drawn polyline *is* content — so an automatic camera zooms and pans **while the finger
    /// is down**, and every subsequent screen point converts against a different projection. The
    /// stroke comes out kinked and the map lurches (caught in the simulator; the drawn line diverged
    /// from the traced one). A concrete region never moves unless the user moves it in Move-map mode.
    private func prepare() {
        referenceCoordinates = referenceRoute?.clCoordinates ?? []
        camera = .region(Self.initialRegion(referenceRoute: referenceRoute, fallbackRegion: fallbackRegion))
    }

    /// The region to open on: the reference route's extent, else the caller's region, else a wide
    /// view the user can pan and zoom from. Never `.automatic` — see `prepare()`.
    static func initialRegion(referenceRoute: Route?, fallbackRegion: MKCoordinateRegion?) -> MKCoordinateRegion {
        let routePoints = referenceRoute?.clCoordinates ?? []
        if routePoints.count > 1 { return .fitting(routePoints) }
        if let fallbackRegion { return fallbackRegion }
        return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 20, longitude: 0),
                                  span: MKCoordinateSpan(latitudeDelta: 120, longitudeDelta: 240))
    }
}
