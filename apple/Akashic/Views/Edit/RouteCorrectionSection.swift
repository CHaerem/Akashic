import SwiftUI
import MapKit
import UniformTypeIdentifiers

/// The "Route" block inside `JourneyEditSheet` — the route is no longer frozen after creation.
///
/// Four corrections, each showing a PREVIEW (old vs new polyline + a stats diff) before Apply:
///   * Replace route from GPX (same parser/limits as creation),
///   * Draft route from the journey's geotagged photos (reuses `RouteInference`),
///   * Draw the route by hand on a map (reuses `RouteDrawing` — for journeys with neither a track
///     nor geotagged photos, and for fixing a stretch the other two got wrong),
///   * Recompute stats from the current route (fixes stale stats after any edit).
///
/// Apply writes route + recomputed stats through the normal edit path (`JourneyStore.replaceRoute`).
/// Days are NEVER silently re-seeded; when a replacing GPX carries waypoints, the preview offers a
/// separate opt-in "Also update day positions".
struct RouteCorrectionSection: View {
    @EnvironmentObject private var store: JourneyStore
    let journey: Journey

    @State private var showingImporter = false
    @State private var preview: RoutePreview?
    @State private var message: String?

    // Draw-on-map. The drawing is stashed and turned into a preview once the drawing sheet has
    // dismissed — presenting the preview while that sheet is still on screen would be dropped.
    @State private var showingDrawing = false
    @State private var drawnRoute: RouteDrawing.DrawnRoute?

    /// Whether this journey already has a route — decides "Import" vs "Replace" wording.
    private var hasRoute: Bool { !journey.route.coordinates.isEmpty }

    var body: some View {
        GlassField(label: "Route", systemImage: "point.topleft.down.to.point.bottomright.curvepath") {
            VStack(alignment: .leading, spacing: 10) {
                // A journey with no route yet is not "replacing" anything — the verb follows reality.
                row(icon: "arrow.down.doc",
                    title: hasRoute ? "Replace route from GPX" : "Import route from GPX",
                    subtitle: hasRoute
                        ? "Import a new track — preview before it replaces this route"
                        : "Import a track from Strava, Garmin, AllTrails or komoot") {
                    message = nil
                    showingImporter = true
                }
                row(icon: "photo.on.rectangle.angled", title: "Draft route from photos",
                    subtitle: "Build a route from this journey's geotagged photos") {
                    draftFromPhotos()
                }
                row(icon: "scribble", title: hasRoute ? "Redraw route on map" : "Draw route on map",
                    subtitle: "Trace the route by hand — no track or geotags needed") {
                    message = nil
                    showingDrawing = true
                }
                // Nothing to recompute from until a route exists.
                if hasRoute {
                    row(icon: "function", title: "Recompute stats from route",
                        subtitle: "Refresh distance, ascent and summit from the current route") {
                        recomputeStats()
                    }
                }
                if let message {
                    Text(message).font(.caption2).foregroundStyle(Theme.textTertiary)
                }
            }
            .sheet(isPresented: $showingDrawing, onDismiss: previewDrawnRoute) {
                RouteDrawingSheet(title: journey.route.coordinates.isEmpty ? "Draw route" : "Redraw route",
                                  referenceRoute: journey.route,
                                  fallbackRegion: journey.mapRegion) { drawn in
                    drawnRoute = drawn
                }
            }
        }
        .fileImporter(isPresented: $showingImporter,
                      allowedContentTypes: Self.gpxContentTypes,
                      allowsMultipleSelection: false,
                      onCompletion: handleImport)
        .sheet(item: $preview) { preview in
            RoutePreviewSheet(preview: preview, journey: journey) { updated, alsoUpdatePositions in
                apply(updated, alsoUpdatePositions: alsoUpdatePositions)
            }
            .environmentObject(store)
        }
    }

    /// QUA-24: the glyph and the chevron are both decoration — the glyph restates the title and the
    /// chevron restates the button trait. The subtitle becomes a hint rather than part of the label,
    /// so the four corrections are distinguishable at a swipe and the explanation follows only if the
    /// user waits for it.
    private func row(icon: String, title: LocalizedStringKey, subtitle: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.title3).foregroundStyle(Theme.accent).frame(width: 26)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                    Text(subtitle).font(.caption2).foregroundStyle(Theme.textTertiary)
                        .accessibilityHidden(true)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(12)
            .frame(maxWidth: .infinity)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityHint(subtitle)
    }

    // MARK: Build previews

    private func draftFromPhotos() {
        message = nil
        let fixes = RouteCorrection.fixes(from: store.photos(forJourneyID: journey.id))
        guard !fixes.isEmpty else {
            message = String(localized: "No geotagged photos to draft a route from.",
                             comment: "Route correction: shown when drafting a route from photos finds no GPS data.")
            return
        }
        let result = RouteInference.infer(from: fixes)
        guard !result.isEmpty else {
            message = String(localized: "Couldn't draft a route from these photos.",
                             comment: "Route correction: shown when drafting a route from photos produces nothing usable.")
            return
        }
        preview = makePreview(newRoute: result.route, gpxWaypoints: [], note: result.confidence.summary)
    }

    /// Turn the drawn route into the same Apply preview every other correction goes through, so a
    /// hand-drawn replacement is reviewed (old vs new polyline + stats diff) exactly like a GPX one.
    /// The summary comes from the drawing itself, so the bridged-gap count the sheet showed survives
    /// into the preview instead of being re-derived (and lost) here.
    private func previewDrawnRoute() {
        guard let drawn = drawnRoute else { return }
        drawnRoute = nil
        preview = makePreview(newRoute: drawn.route, gpxWaypoints: [],
                              note: "\(drawn.summary). \(RouteDrawing.elevationNote)")
    }

    private func recomputeStats() {
        message = nil
        guard !journey.route.coordinates.isEmpty else {
            message = String(localized: "This journey has no route to recompute stats from.",
                             comment: "Route correction: shown when Recompute stats is tapped on a journey with no route.")
            return
        }
        preview = makePreview(newRoute: journey.route, gpxWaypoints: [],
                              note: String(localized: "Stats only — the route itself is unchanged.",
                                     comment: "Route correction: note on the recompute-stats preview."))
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case let .failure(error):
            message = error.localizedDescription
        case let .success(urls):
            guard let url = urls.first else { return }
            Task { await parse(url) }
        }
    }

    @MainActor
    private func parse(_ url: URL) async {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        do {
            let file = try await Task.detached(priority: .userInitiated) {
                try GPXParser.parse(contentsOf: url)
            }.value
            // Same three plural-varied catalogue entries the new-journey sheet uses for a GPX
            // provenance line, so the two screens describe an imported track identically.
            var note = String(localized: "\(file.route.coordinates.count) route points",
                              comment: "GPX route provenance: how many coordinates the track holds.")
                     + " · " + String(localized: "\(file.waypoints.count) waypoints",
                                      comment: "GPX route provenance: how many waypoints became days.")
            if file.droppedPointCount > 0 {
                note += " · " + String(localized: "\(file.droppedPointCount) skipped",
                                       comment: "GPX route provenance: coordinates dropped as unusable.")
            }
            preview = makePreview(newRoute: file.route, gpxWaypoints: file.waypoints, note: note)
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func makePreview(newRoute: Route, gpxWaypoints: [GPXWaypoint], note: String?) -> RoutePreview {
        let newStats = RouteCorrection.recomputedStats(
            route: newRoute, currentDuration: journey.stats.duration, dayCount: journey.camps.count,
            dateStarted: journey.dateStarted, dateEnded: journey.dateEnded, name: journey.shortName)
        return RoutePreview(oldRoute: journey.route, newRoute: newRoute,
                            oldStats: journey.stats, newStats: newStats,
                            gpxWaypoints: gpxWaypoints, note: note)
    }

    // MARK: Apply

    private func apply(_ preview: RoutePreview, alsoUpdatePositions: Bool) {
        let positions: [(coordinate: [Double], elevation: Int)]?
        if alsoUpdatePositions, !preview.gpxWaypoints.isEmpty {
            positions = preview.gpxWaypoints.map {
                (coordinate: Array($0.coordinates.prefix(2)),
                 elevation: $0.elevation.map { Int($0.rounded()) } ?? 0)
            }
        } else {
            positions = nil
        }
        store.replaceRoute(journeyID: journey.id, route: preview.newRoute, positions: positions)
    }

    static var gpxContentTypes: [UTType] {
        var types: [UTType] = []
        if let gpx = UTType("com.topografix.gpx") { types.append(gpx) }
        if let byExtension = UTType(filenameExtension: "gpx") { types.append(byExtension) }
        types.append(.xml)
        return types
    }
}

/// A staged route correction awaiting the user's Apply. Value type so it drives `.sheet(item:)`.
struct RoutePreview: Identifiable {
    let id = UUID()
    var oldRoute: Route
    var newRoute: Route
    var oldStats: TrekStats
    var newStats: TrekStats
    /// GPX waypoints carried by a replacing file (empty for photo-draft / recompute) — the basis for
    /// the opt-in "Also update day positions".
    var gpxWaypoints: [GPXWaypoint]
    var note: String?

    /// True when the route itself changes (vs. a stats-only recompute).
    var routeChanges: Bool { oldRoute.coordinates != newRoute.coordinates }
}

/// The Apply preview: a mini-map (old route in grey, new in accent), the before→after stats diff,
/// and — only when the new route carries GPX waypoints — an opt-in to also move the days.
struct RoutePreviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    let preview: RoutePreview
    let journey: Journey
    /// `(preview, alsoUpdatePositions)`.
    var onApply: (RoutePreview, Bool) -> Void

    @State private var alsoUpdatePositions = false
    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        EditSheetScaffold(
            title: "Preview route",
            saveTitle: "Apply",
            onCancel: { dismiss() },
            onSave: {
                onApply(preview, alsoUpdatePositions)
                dismiss()
            }
        ) {
            miniMap
            if let note = preview.note {
                Text(note).font(.caption).foregroundStyle(Theme.textSecondary)
            }
            diffCard
            legend
            if preview.routeChanges, !preview.gpxWaypoints.isEmpty {
                dayPositionsToggle
            }
        }
    }

    private var miniMap: some View {
        Map(position: $camera, interactionModes: []) {
            if preview.oldRoute.clCoordinates.count > 1 {
                MapPolyline(coordinates: preview.oldRoute.clCoordinates)
                    .stroke(Theme.textTertiary, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [4, 4]))
            }
            if preview.newRoute.clCoordinates.count > 1 {
                MapPolyline(coordinates: preview.newRoute.clCoordinates)
                    .stroke(Theme.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
            }
        }
        .mapStyle(.standard(elevation: .flat))
        .frame(height: 200)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .onAppear { camera = .region(Self.region(old: preview.oldRoute, new: preview.newRoute)) }
        // QUA-24: two overlaid polylines are the one thing on this sheet a screen reader genuinely
        // cannot convey. Saying so is more use than silence — and the diff card below is where the
        // decision actually gets made, in numbers, which ARE readable.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(preview.routeChanges
                            ? "Map comparing the current route with the new one"
                            : "Map of the current route")
        .accessibilityHint("The change is stated as numbers below")
    }

    private var legend: some View {
        HStack(spacing: 16) {
            legendItem(color: Theme.textTertiary, label: "Current")
            legendItem(color: Theme.accent, label: "New")
        }
        .font(.caption2)
        // A colour key for a map that cannot be read anyway — announcing "Current" and "New" as two
        // bare words in the middle of the sheet is noise.
        .accessibilityHidden(true)
    }

    private func legendItem(color: Color, label: LocalizedStringKey) -> some View {
        HStack(spacing: 6) {
            Capsule().fill(color).frame(width: 18, height: 3)
            Text(label).foregroundStyle(Theme.textTertiary)
        }
    }

    /// QUA-24: each diff line is four separate elements — label, before, an arrow glyph, after — so
    /// "Distance", "35 km", "arrow right", "42 km" were four swipes to learn one fact, and the arrow
    /// is what carried the direction. Combined into one sentence per line, with the arrow replaced by
    /// a word and "changed" stated rather than left to bold weight.
    private var diffCard: some View {
        VStack(spacing: 8) {
            ForEach(RouteCorrection.diff(old: preview.oldStats, new: preview.newStats)) { line in
                HStack {
                    Text(line.label).font(.subheadline).foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Text(line.before).font(.subheadline).foregroundStyle(Theme.textTertiary)
                    Image(systemName: "arrow.right").font(.caption2).foregroundStyle(Theme.textTertiary)
                    Text(line.after)
                        .font(.subheadline.weight(line.changed ? .bold : .regular))
                        .foregroundStyle(line.changed ? Theme.accent : Theme.textSecondary)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(line.changed
                                    ? Text("\(line.label), changes from \(line.before) to \(line.after)")
                                    : Text("\(line.label), unchanged at \(line.after)"))
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    private var dayPositionsToggle: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: $alsoUpdatePositions) {
                Text("Also update day positions")
                    .font(.subheadline).foregroundStyle(Theme.textPrimary)
            }
            .tint(Theme.accent)
            Text("Move each day's location to the matching GPX waypoint (by order). Day names and content are kept.")
                .font(.caption2).foregroundStyle(Theme.textTertiary)
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    /// A region covering both routes so the diff is visible at a glance.
    static func region(old: Route, new: Route) -> MKCoordinateRegion {
        .fitting(old.clCoordinates + new.clCoordinates)
    }
}
