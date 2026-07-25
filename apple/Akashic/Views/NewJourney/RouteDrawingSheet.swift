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
/// Strokes are kept individually so **Undo** is exact: drop the last stroke and refold.
///
/// Elevation is deliberately absent (`RouteDrawing.elevationNote`) — the note is on screen before
/// the user commits, never discovered afterwards in wrong stats.
struct RouteDrawingSheet: View {
    @Environment(\.dismiss) private var dismiss

    var title: String = "Draw route"
    /// The journey's current route, drawn dashed underneath as a reference when replacing.
    var referenceRoute: Route?
    /// Where to open when there is no reference route (day median / journey centre), `[lng, lat]`.
    var fallbackCenter: [Double]?
    /// Called with the drawn route on Done. Never called with fewer than two points.
    var onDone: (Route) -> Void

    private enum Mode: String, CaseIterable, Identifiable {
        case draw, pan
        var id: String { rawValue }
        var label: String { self == .draw ? "Draw" : "Move map" }
        var icon: String { self == .draw ? "scribble" : "hand.draw" }
    }

    @State private var mode: Mode = .draw
    /// Committed strokes, each already simplified. The source of truth for what has been drawn.
    @State private var strokes: [[[Double]]] = []
    /// The stroke currently under the finger.
    @State private var current: [[Double]] = []
    @State private var camera: MapCameraPosition = .automatic

    // MARK: Derived

    private var folded: (points: [[Double]], joins: [RouteDrawing.Join]) {
        RouteDrawing.fold(strokes: strokes)
    }

    private var drawnPoints: [[Double]] { folded.points }

    private var bridgedGaps: Int {
        folded.joins.filter { $0.bridgeMeters > 0 }.count
    }

    private var canFinish: Bool { drawnPoints.count >= 2 }

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
                        onDone(RouteDrawing.route(from: drawnPoints))
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .tint(Theme.accent)
                    .disabled(!canFinish)
                }
            }
            .onAppear(perform: positionCamera)
        }
    }

    // MARK: Map

    private var map: some View {
        MapReader { proxy in
            ZStack {
                Map(position: $camera, interactionModes: mode == .pan ? .all : []) {
                    if let referenceRoute, referenceRoute.clCoordinates.count > 1 {
                        MapPolyline(coordinates: referenceRoute.clCoordinates)
                            .stroke(Theme.textTertiary,
                                    style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [4, 4]))
                    }
                    if drawnPoints.count > 1 {
                        MapPolyline(coordinates: Self.clCoordinates(drawnPoints))
                            .stroke(Theme.accent,
                                    style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                    }
                    if current.count > 1 {
                        MapPolyline(coordinates: Self.clCoordinates(current))
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
    }

    // MARK: Overlays

    private var hint: some View {
        Text(mode == .draw ? "Trace the route with one finger" : "Pan and zoom, then switch to Draw")
            .font(.footnote)
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
            .padding(.top, 12)
    }

    private var controls: some View {
        VStack(spacing: 10) {
            Picker("Mode", selection: $mode) {
                ForEach(Mode.allCases) { mode in
                    Label(mode.label, systemImage: mode.icon).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            HStack(spacing: 10) {
                Text(readout)
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    strokes.removeLast()
                } label: {
                    Image(systemName: "arrow.uturn.backward")
                }
                .disabled(strokes.isEmpty)
                Button {
                    strokes = []
                    current = []
                } label: {
                    Image(systemName: "trash")
                }
                .disabled(strokes.isEmpty)
            }
            .font(.subheadline.weight(.semibold))
            .tint(Theme.accent)

            Text(RouteDrawing.elevationNote)
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
    }

    private var readout: String {
        guard canFinish else { return "Nothing drawn yet" }
        return RouteDrawing.summary(pointCount: drawnPoints.count,
                                    distanceKm: JourneyDraft.totalDistanceKm(route: drawnPoints),
                                    bridgedGaps: bridgedGaps)
    }

    // MARK: Camera

    /// Pin the camera to a concrete region before the user can draw.
    ///
    /// This is load-bearing, not cosmetic: `.automatic` re-frames itself to fit the map's content,
    /// and the drawn polyline *is* content — so an automatic camera zooms and pans **while the finger
    /// is down**, and every subsequent screen point converts against a different projection. The
    /// stroke comes out kinked and the map lurches (caught in the simulator; the drawn line diverged
    /// from the traced one). A concrete region never moves unless the user moves it in Move-map mode.
    private func positionCamera() {
        camera = .region(Self.initialRegion(referenceRoute: referenceRoute, fallbackCenter: fallbackCenter))
    }

    /// The region to open on: the reference route's extent, else the caller's centre, else a wide
    /// view the user can pan and zoom from. Never `.automatic` — see `positionCamera()`.
    static func initialRegion(referenceRoute: Route?, fallbackCenter: [Double]?) -> MKCoordinateRegion {
        if let referenceRoute, referenceRoute.clCoordinates.count > 1 {
            return RoutePreviewSheet.region(old: referenceRoute, new: .empty)
        }
        if let fallbackCenter, fallbackCenter.count >= 2 {
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: fallbackCenter[1], longitude: fallbackCenter[0]),
                span: MKCoordinateSpan(latitudeDelta: 0.2, longitudeDelta: 0.2))
        }
        return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 20, longitude: 0),
                                  span: MKCoordinateSpan(latitudeDelta: 120, longitudeDelta: 240))
    }

    static func clCoordinates(_ points: [[Double]]) -> [CLLocationCoordinate2D] {
        points.compactMap { point in
            guard point.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: point[1], longitude: point[0])
        }
    }
}
