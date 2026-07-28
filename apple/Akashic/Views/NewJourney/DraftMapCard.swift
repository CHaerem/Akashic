import SwiftUI
import MapKit

/// C5 — the review screen's map preview: the moment the drafted trip appears on a map, and the
/// honest accounting of what was inferred to make it, in one object (see the C-series in
/// `apple/Docs/DESIGN-PLAN.md`). Below the map sits a single provenance line — whichever source
/// produced the route — and a **Route options** menu (Replace with GPX · Draw on map · Remove
/// route). When there is nothing to draw yet, C6's partial-failure copy takes the map's place.
///
/// **Live `Map`, not `MKMapSnapshotter`.** `RoutePreviewSheet.miniMap` already renders a live,
/// `interactionModes: []` `Map` inside this same `EditSheetScaffold` (`ScrollView` + `VStack`, not
/// a `List`) without a reported scroll problem — a `List`'s cell-recycling is where a live map
/// inside a scrolling surface actually costs something, and this screen isn't one. Reusing that
/// exact pattern also means the route rendering (polyline styling, region fitting) has one
/// implementation across the app instead of a second, snapshot-based one just for this card, and
/// it stays trivially reactive to day deletion / re-import — a snapshot would need to be
/// regenerated (async, off-main) on every such edit instead of simply re-laying-out.
struct DraftMapCard: View {
    /// The draft's current route. `nil` or fewer than 2 coordinates both mean "no line to draw".
    var route: Route?
    /// Days considered for map pins; a day with no coordinates (an unplaced manual day) is
    /// skipped — there is nowhere honest to put its pin. Pin numbers follow each day's position in
    /// THIS array (not its position among pinned days only), so they always agree with the Days
    /// section's own numbering even when some days in between have no location yet.
    var days: [DraftDay]
    /// The single provenance sentence for whichever source produced `route` — `RouteConfidence
    /// .summary` verbatim for photo inference, `RouteSummary.provenanceLine` for GPX, or
    /// `RouteDrawing.DrawnRoute.summary` + `.elevationNote` for a hand-drawn route (all computed by
    /// the caller, which is the one place that knows which provenance is live). `nil` reads as
    /// "nothing to caption" — expected whenever there is no map content either.
    var provenance: String?
    /// C6: true once photos were picked and days were proposed from their capture dates, but not
    /// one of them carried a usable GPS fix — the specific partial-failure state that earns its
    /// own copy and inline actions instead of the generic "nothing yet" placeholder every other
    /// route-less state shows.
    var photosLackedGPS: Bool = false
    /// The user already tapped "Skip" on the above nudge for this sheet session — fall back to the
    /// quiet placeholder rather than repeating the same three buttons on every scroll back up.
    var nudgeDismissed: Bool = false

    var onImportGPX: () -> Void
    var onDrawOnMap: () -> Void
    var onRemoveRoute: () -> Void
    var onSkipRouteNudge: () -> Void

    private var coordinates: [CLLocationCoordinate2D] { route?.clCoordinates ?? [] }

    /// Each day that has a placed location, paired with its position in the FULL `days` list (see
    /// the property doc above for why that position, not the filtered one, is what gets drawn).
    private var pins: [(number: Int, day: DraftDay)] {
        days.enumerated().compactMap { index, day in
            day.coordinates.count >= 2 ? (index + 1, day) : nil
        }
    }

    /// Whether there is anything at all to show on the map — a route line, day pins, or both. A
    /// GPX file with waypoints but an empty track (rare, but not the same failure as C6's "track,
    /// no waypoints") still earns a map of just its pins rather than being treated as empty.
    private var hasMapContent: Bool { coordinates.count > 1 || !pins.isEmpty }

    /// C6's specific empty state wins only while there truly is nothing to draw and the user
    /// hasn't already dismissed it.
    private var showsPhotoNudge: Bool { !hasMapContent && photosLackedGPS && !nudgeDismissed }

    var body: some View {
        GlassField(label: "Route", systemImage: "map") {
            VStack(alignment: .leading, spacing: 10) {
                // The menu covers every provenance uniformly; the photo-nudge state already offers
                // its own Import/Draw actions inline, so showing both here would just be noise.
                if !showsPhotoNudge {
                    HStack {
                        Spacer()
                        routeOptionsMenu
                    }
                }
                if hasMapContent {
                    mapView
                    if let provenance {
                        Text(provenance).font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                } else if showsPhotoNudge {
                    photosNoGPSEmptyState
                } else {
                    quietEmptyState
                }
            }
        }
    }

    // MARK: Map

    private var mapView: some View {
        // `.constant(...)` rather than `@State` camera: this card's region must track live edits
        // (a day deleted, a route replaced) on every re-render, and there is no user-driven camera
        // to preserve across those — recomputing it from `route`/`days` each time is simpler than
        // an `onChange` that keeps a stored camera in sync, and non-interactive (`interactionModes:
        // []`) means nothing ever writes back into it.
        Map(position: .constant(.region(region)), interactionModes: []) {
            if coordinates.count > 1 {
                MapPolyline(coordinates: coordinates)
                    .stroke(Theme.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
            }
            ForEach(pins, id: \.day.id) { pin in
                if let coordinate = dayCoordinate(pin.day) {
                    Annotation(pin.day.name, coordinate: coordinate) {
                        dayPin(number: pin.number)
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .flat))
        .frame(height: 180)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        // This is a review of the draft, not a place to explore it — the day sheet's own map
        // already owns that job once the journey exists.
        .allowsHitTesting(false)
        // QUA-24: `allowsHitTesting(false)` stops touches, not VoiceOver — the map's own annotations
        // were still reachable, so swiping through the review screen walked every day pin one at a
        // time before reaching the next field. It is a preview; one element saying what it shows is
        // the honest amount of information in it, and the Days section below is where the days
        // themselves are actually navigable.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(mapSummary)
    }

    /// What the preview actually depicts, in words. Deliberately not a claim about shape or
    /// direction — nothing here can describe the line, and pretending otherwise would be worse than
    /// saying what is countable.
    private var mapSummary: Text {
        if coordinates.count > 1 && !pins.isEmpty {
            return Text("Map preview of the drafted route, with \(pins.count) days marked")
        }
        if coordinates.count > 1 {
            return Text("Map preview of the drafted route")
        }
        return Text("Map preview with \(pins.count) days marked")
    }

    private var region: MKCoordinateRegion {
        .fitting(coordinates + pins.compactMap { dayCoordinate($0.day) })
    }

    private func dayCoordinate(_ day: DraftDay) -> CLLocationCoordinate2D? {
        guard day.coordinates.count >= 2 else { return nil }
        return CLLocationCoordinate2D(latitude: day.coordinates[1], longitude: day.coordinates[0])
    }

    /// A numbered pin matching the Days section's own numbered circle, so the same trip reads as
    /// one object across the two sections instead of two different visual vocabularies for "day".
    private func dayPin(number: Int) -> some View {
        Text("\(number)")
            .font(.caption2.weight(.bold))
            .foregroundStyle(Theme.onAccent)
            .frame(width: 20, height: 20)
            .background(Theme.accent, in: Circle())
            .overlay(Circle().strokeBorder(Theme.background, lineWidth: 1.5))
    }

    // MARK: Route options menu

    private var routeOptionsMenu: some View {
        Menu {
            // Wording follows reality, same rule `RouteCorrectionSection` uses: a card with nothing
            // drawn yet is "Import", never "Replace".
            Button(hasMapContent ? "Replace with GPX" : "Import GPX", action: onImportGPX)
            Button("Draw on map", action: onDrawOnMap)
            if hasMapContent {
                Button("Remove route", role: .destructive, action: onRemoveRoute)
            }
        } label: {
            Label("Route options", systemImage: "ellipsis.circle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.accentText)
        }
        .accessibilityLabel("Route options")
        .accessibilityHint("Import a GPX file, draw the route on a map, or remove it")
        // QUA-55: `performAccessibilityAudit` measured this at 104.5 × 14.5 pt on iPad (A16) — a
        // `.caption` label, and the only way to replace, draw or REMOVE the route. Same fix as
        // QUA-29's six: the frame grows the hit area without moving the glyph or the text, and
        // `contentShape` is what makes the grown frame actually tappable. Width already cleared 44.
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    // MARK: Empty states

    /// C6: photos carried readable dates (so days exist) but none carried a GPS fix — the journey
    /// must stay fully creatable from here, hence three ways forward rather than a dead end.
    private var photosNoGPSEmptyState: some View {
        VStack(alignment: .leading, spacing: 10) {
            emptyGlyph
            Text("Your photos carry dates but no locations, so days were proposed without a route.")
                .font(.caption).foregroundStyle(Theme.textSecondary)
            actionButton(icon: "arrow.down.doc", title: "Import GPX", action: onImportGPX)
            actionButton(icon: "scribble", title: "Draw on map", action: onDrawOnMap)
            Button("Skip — add a route later", action: onSkipRouteNudge)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textSecondary)
        }
    }

    /// The default "nothing yet" state — a fresh just-a-name draft, a GPX not yet picked, or the
    /// photo nudge above once skipped. Not a dead end either: the menu above still reaches both
    /// route sources.
    private var quietEmptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            emptyGlyph
            Text("No route yet — import a GPX, draw one on the map, or leave it for later.")
                .font(.caption2).foregroundStyle(Theme.textTertiary)
        }
    }

    private var emptyGlyph: some View {
        HStack {
            Spacer()
            Image(systemName: "map")
                .font(.title)
                .foregroundStyle(Theme.textTertiary)
            Spacer()
        }
        // A placeholder for a map that isn't there — the sentence beneath it carries the meaning.
        .accessibilityHidden(true)
        .frame(height: 64)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
    }

    private func actionButton(icon: String, title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.subheadline).foregroundStyle(Theme.accentText)
                    .accessibilityHidden(true)
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                Spacer()
            }
            .padding(12)
            .frame(maxWidth: .infinity)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Theme.accent.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            )
        }
        .buttonStyle(.plain)
    }
}
