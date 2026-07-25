import SwiftUI
import MapKit
import PhotosUI
import UniformTypeIdentifiers

/// Create a journey from scratch (§4.1) — the counterpart to the arrive-only import/sync paths.
///
/// A two-phase sheet (C1 — see `apple/Docs/DESIGN-PLAN.md`): Phase 1 (`NewJourneyChooser`) asks
/// "what do you have?" — photos, a GPX file, or just a name — and Phase 2 (`reviewBody`, below) is
/// a single review screen every path converges on. The user makes one decision, then reviews a
/// proposal instead of filling a form. Route import and photo-day-seeding are both optional: a
/// journey with no route and no days is valid (a photos-only trip). On create the journey is
/// persisted through `JourneyStore.createJourney` (which routes through the same Core Data seam
/// sync observes), then the app flies into it.
struct NewJourneySheet: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @EnvironmentObject private var intelligence: Intelligence
    @Environment(\.dismiss) private var dismiss

    /// Called with the created journey after a successful save (so a presenter can dismiss its
    /// own container — e.g. the Journeys list sheet — and let the globe fly to it).
    var onCreated: (Journey) -> Void

    // MARK: Phase

    /// Where the review phase's draft came from. Carried alongside `.review` (rather than tracked
    /// separately) so it can never go stale relative to which screen is actually on screen; later
    /// tasks (C3–C6) branch on it to decide what to apply by default and which caption to show —
    /// C1 itself changes no behaviour based on it.
    enum ReviewOrigin: Equatable {
        case photos
        case gpx
        case nameOnly
        /// The sheet was created via `init(preloadedGPX:...)` (C7: opening a `.gpx` from Files or
        /// Mail) — the chooser never appeared.
        case openedFile
    }

    enum Phase: Equatable {
        case chooser
        case review(origin: ReviewOrigin)
    }

    @State private var phase: Phase = .chooser

    @State private var draft = JourneyDraft()
    @State private var hasStart = false
    @State private var startDate = Date()
    @State private var hasEnd = false
    @State private var endDate = Date()

    // Route import (review screen's own re-import / replace).
    @State private var showingImporter = false
    @State private var routeSummary: RouteSummary?
    @State private var importError: String?

    // Draw-on-map. The drawing is stashed and applied on the sheet's dismissal, so the
    // suggestion pass never runs while a sheet is still on screen.
    @State private var showingDrawing = false
    @State private var drawnRoute: RouteDrawing.DrawnRoute?

    // Photo day-seeding.
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var isReadingPhotos = false
    @State private var photoDayCount = 0

    @State private var isSaving = false
    @State private var saveError: String?
    @State private var showPaywall = false

    /// Set only by `init(preloadedGPX:...)`: the suggestion pass needs `entitlements`/
    /// `intelligence` from the environment, which aren't available at init time, so it is deferred
    /// to a `.task` on first appearance and then cleared.
    @State private var needsInitialSuggestionsRun = false

    /// Keyboard focus for the name field — set the moment "Start with just a name" is chosen, so
    /// the user lands in review with the keyboard already up instead of having to tap in.
    @FocusState private var isNameFieldFocused: Bool

    // M6 — on-device day-name suggestions (Apple Intelligence).
    @State private var isSuggestingNames = false
    @State private var suggestNamesFailed = false

    // Assisted creation — the "Suggestions" layer (route-from-photos, country, camp names,
    // weather, POIs, facts). The coordinator is created up front; its facts gate is configured
    // once the environment resolves, and providers run only after photos/GPX land.
    @StateObject private var suggestions = JourneySuggestionCoordinator.live(factsEnabled: false)
    /// Geotagged photo observations from the last pick — the basis for route inference.
    @State private var photoFixes: [PhotoFix] = []

    /// "Suggest names" appears only with the on-device model available, Akashic Complete, and at
    /// least one seeded day — otherwise the feature is simply absent.
    private var showsSuggestNames: Bool {
        intelligence.isAvailable && entitlements.isComplete && !draft.days.isEmpty
    }

    private struct RouteSummary: Equatable {
        var pointCount: Int
        var distanceKm: Double
        var waypointCount: Int
        var droppedCount: Int
        /// Provenance the card must state in words — today only a hand-drawn route has one (it
        /// carries no elevation, and may contain straight legs between detached strokes). Carrying
        /// the sentence rather than a flag means the caller that knows the provenance writes it once.
        var drawnNote: String?
    }

    // MARK: Init

    init(onCreated: @escaping (Journey) -> Void = { _ in }) {
        self.onCreated = onCreated
    }

    /// Entry point for C7 (registering Akashic as a GPX document handler / `onOpenURL`): skips the
    /// chooser entirely and starts directly in review with `file`'s route — and its waypoint days,
    /// when it has any — already applied. The user already told the system which file to open, so
    /// asking "what do you have?" again would be backwards.
    init(preloadedGPX file: GPXFile, suggestedName: String = "",
         onCreated: @escaping (Journey) -> Void = { _ in }) {
        self.onCreated = onCreated
        var draft = JourneyDraft()
        draft.name = suggestedName
        let applied = Self.applying(file, toDays: draft.days)
        draft.route = applied.route
        draft.days = applied.days
        _draft = State(initialValue: draft)
        _routeSummary = State(initialValue: applied.summary)
        _phase = State(initialValue: .review(origin: .openedFile))
        _needsInitialSuggestionsRun = State(initialValue: true)
    }

    var body: some View {
        Group {
            switch phase {
            case .chooser:
                NewJourneyChooser(
                    photoSelection: $photoSelection,
                    onGPXImported: { file in
                        applyImportedGPX(file)
                        phase = .review(origin: .gpx)
                        Task { await runSuggestions() }
                    },
                    onNameOnly: { phase = .review(origin: .nameOnly) },
                    onCancel: { dismiss() })
            case .review:
                reviewBody
            }
        }
        // Lives above the phase switch because the photo picker itself is presented from the
        // chooser card, but its result must be handled the same way regardless of which phase is
        // on screen (the review screen's own "Days from photos" section reuses this exact binding
        // to seed MORE days later).
        .onChange(of: photoSelection) { _, items in
            guard !items.isEmpty else { return }
            if case .chooser = phase { phase = .review(origin: .photos) }
            Task { await seedDaysFromPhotos(items) }
        }
        .task {
            guard needsInitialSuggestionsRun else { return }
            needsInitialSuggestionsRun = false
            await runSuggestions()
        }
    }

    private var reviewBody: some View {
        EditSheetScaffold(
            title: "New Journey",
            saveTitle: "Create",
            saveDisabled: !draft.isValid || isSaving || isReadingPhotos,
            isSaving: isSaving,
            onCancel: { dismiss() },
            onSave: create
        ) {
            // Order per the design review: name, route summary, country, dates, days, suggestions.
            // "Days from photos" isn't in that list — it seeds Days, so it stays immediately
            // before it, same adjacency it had before this restructuring.
            nameSection
            routeSection
            countrySection
            datesSection
            photosSection
            daysSection
            suggestionsSection
            if let saveError {
                Text(saveError).font(.footnote).foregroundStyle(.red)
            }
        }
        .interactiveDismissDisabled(isSaving)
        .sheet(isPresented: $showPaywall) {
            PaywallView(reason: .journeyLimit)
                .environmentObject(entitlements)
        }
        .fileImporter(isPresented: $showingImporter,
                      allowedContentTypes: gpxContentTypes,
                      allowsMultipleSelection: false,
                      onCompletion: handleImport)
    }

    // MARK: Name

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            GlassField(label: "Name", systemImage: "flag") {
                GlassTextField(placeholder: "e.g. Kilimanjaro — Lemosho Route", text: $draft.name)
                    .focused($isNameFieldFocused)
                    // Set just after APPEARANCE, not at the moment the chooser hands off: the
                    // field doesn't exist yet when "Start with just a name" is tapped (review is
                    // a whole different branch of the phase switch), and even on `onAppear`
                    // itself the responder chain isn't settled enough for `@FocusState` to take —
                    // one run-loop turn later it reliably does.
                    .onAppear {
                        guard case .review(.nameOnly) = phase else { return }
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 150_000_000)
                            isNameFieldFocused = true
                        }
                    }
            }
            GlassField(label: "Description", systemImage: "text.alignleft") {
                GlassTextEditor(text: $draft.description, minHeight: 90)
            }
        }
    }

    // MARK: Country

    private var countrySection: some View {
        GlassField(label: "Country", systemImage: "globe") {
            GlassTextField(placeholder: "Country", text: $draft.country)
        }
    }

    // MARK: Dates

    private var datesSection: some View {
        GlassField(label: "Dates", systemImage: "calendar.badge.clock") {
            VStack(spacing: 10) {
                dateRow(label: "Start", isOn: $hasStart, date: $startDate)
                dateRow(label: "End", isOn: $hasEnd, date: $endDate)
            }
            .padding(12)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
    }

    private func dateRow(label: String, isOn: Binding<Bool>, date: Binding<Date>) -> some View {
        HStack {
            Toggle(isOn: isOn) {
                Text(label).font(.subheadline).foregroundStyle(Theme.textPrimary)
            }
            .tint(Theme.accent)
            .fixedSize()
            Spacer()
            if isOn.wrappedValue {
                DatePicker("", selection: date, displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
            }
        }
        .onChange(of: isOn.wrappedValue) { _, _ in syncDates() }
        .onChange(of: date.wrappedValue) { _, _ in syncDates() }
    }

    private func syncDates() {
        draft.dateStarted = hasStart ? startDate : nil
        draft.dateEnded = hasEnd ? endDate : nil
    }

    // MARK: Route (GPX import / draw on map)

    private var routeSection: some View {
        GlassField(label: "Route", systemImage: "point.topleft.down.to.point.bottomright.curvepath") {
            VStack(alignment: .leading, spacing: 10) {
                routeButton(icon: "arrow.down.doc",
                            title: routeSummary == nil ? "Import route (GPX)" : "Replace route") {
                    importError = nil
                    showingImporter = true
                }
                routeButton(icon: "scribble",
                            title: draft.hasRoute ? "Redraw route on map" : "Draw route on map") {
                    importError = nil
                    showingDrawing = true
                }

                if let summary = routeSummary {
                    HStack(spacing: 14) {
                        summaryStat("\(summary.pointCount)", "points")
                        summaryStat(Formatters.distanceKm(summary.distanceKm), "distance")
                        summaryStat("\(summary.waypointCount)", "waypoints")
                    }
                    if summary.droppedCount > 0 {
                        Text("\(summary.droppedCount) out-of-range point(s) skipped")
                            .font(.caption2).foregroundStyle(Theme.textTertiary)
                    }
                    if let drawnNote = summary.drawnNote {
                        Text(drawnNote)
                            .font(.caption2).foregroundStyle(Theme.textTertiary)
                    }
                }
                if let importError {
                    Text(importError).font(.footnote).foregroundStyle(Theme.warning)
                }
                Text("GPX from Strava, Garmin, AllTrails or komoot — or draw it yourself. No route is fine too.")
                    .font(.caption2).foregroundStyle(Theme.textTertiary)
            }
            // The drawing sheet is applied on DISMISSAL (`onDismiss: applyDrawnRoute`), never from
            // inside its own Done: the suggestion pass it kicks off must not start while a sheet is
            // still on screen.
            .sheet(isPresented: $showingDrawing, onDismiss: applyDrawnRoute) {
                RouteDrawingSheet(title: draft.hasRoute ? "Redraw route" : "Draw route",
                                  referenceRoute: draft.route,
                                  fallbackRegion: drawingRegion) { drawn in
                    drawnRoute = drawn
                }
            }
        }
    }

    private func routeButton(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.title3).foregroundStyle(Theme.accent)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Theme.accent.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            )
        }
        .buttonStyle(.plain)
    }

    private func summaryStat(_ value: String, _ caption: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
            Text(caption).font(.caption2).foregroundStyle(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8).padding(.horizontal, 12)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var gpxContentTypes: [UTType] {
        var types: [UTType] = []
        if let gpx = UTType("com.topografix.gpx") { types.append(gpx) }
        if let byExtension = UTType(filenameExtension: "gpx") { types.append(byExtension) }
        types.append(.xml)
        return types
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case let .failure(error):
            importError = error.localizedDescription
        case let .success(urls):
            guard let url = urls.first else { return }
            importError = nil
            Task { await parseRoute(from: url) }
        }
    }

    /// Parse the picked GPX and apply it to the draft, then run suggestions — the review screen's
    /// own "Replace route" path. Off the main actor via `GPXParser.parseSecurityScoped`, so a large
    /// file never freezes the UI.
    @MainActor
    private func parseRoute(from url: URL) async {
        do {
            let file = try await GPXParser.parseSecurityScoped(url)
            applyImportedGPX(file)
            // A route + days now exist — offer country / camp names / weather / POIs / facts.
            await runSuggestions()
        } catch {
            importError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Pure combination of a parsed GPX file with the current day list: refreshed route + summary
    /// unconditionally, and days reseeded from the file's waypoints ONLY when the current list is
    /// still entirely auto-proposed (an unedited first import, e.g. the wrong file) — otherwise the
    /// previous file's days would linger while the summary advertised the new file's waypoints. A
    /// day list the user has actually worked on is never clobbered.
    ///
    /// Static and side-effect-free so the phase-1 chooser's import, the review screen's re-import,
    /// and the C7 preload initialiser can all share it without any of them touching instance state
    /// they don't own. (quality gate: replace route keeps stale auto-seeded days.)
    private static func applying(_ file: GPXFile, toDays currentDays: [DraftDay])
        -> (route: Route, summary: RouteSummary, days: [DraftDay]) {
        let summary = RouteSummary(
            pointCount: file.trackPointCount,
            distanceKm: JourneyDraft.totalDistanceKm(route: file.route.coordinates),
            waypointCount: file.waypoints.count,
            droppedCount: file.droppedPointCount)
        let days = (currentDays.isEmpty || JourneyDraft.daysAreAllAutoSeeded(currentDays))
            ? JourneyDraft.days(fromWaypoints: file.waypoints)
            : currentDays
        return (file.route, summary, days)
    }

    private func applyImportedGPX(_ file: GPXFile) {
        let applied = Self.applying(file, toDays: draft.days)
        draft.route = applied.route
        routeSummary = applied.summary
        draft.days = applied.days
    }

    // MARK: Draw on map

    /// Where the drawing map opens when there is no route yet: the region framing every day we have
    /// placed, else the geotagged photos from the pick. Nil opens on a wide view.
    private var drawingRegion: MKCoordinateRegion? {
        let dayPoints = draft.days.map(\.coordinates).clCoordinates
        if !dayPoints.isEmpty { return .fitting(dayPoints) }
        let photoPoints = photoFixes.map(\.coordinate).clCoordinates
        return photoPoints.isEmpty ? nil : .fitting(photoPoints)
    }

    /// Apply a route drawn in the sheet, once that sheet is gone. Days are untouched — a drawn route
    /// carries no waypoints, so there is nothing to seed from and nothing to clobber.
    private func applyDrawnRoute() {
        guard let drawn = drawnRoute else { return }
        drawnRoute = nil
        draft.route = drawn.route
        routeSummary = RouteSummary(
            pointCount: drawn.pointCount,
            distanceKm: drawn.distanceKm,
            waypointCount: 0,
            droppedCount: 0,
            drawnNote: drawn.bridgedGaps > 0
                ? "\(drawn.summary). \(RouteDrawing.elevationNote)"
                : RouteDrawing.elevationNote)
        // A route now exists — offer country / camp names / weather / POIs / facts, exactly as an
        // imported GPX does.
        Task { await runSuggestions() }
    }

    // MARK: Photos (seed days from photo dates)

    private var photosSection: some View {
        GlassField(label: "Days from photos", systemImage: "photo.on.rectangle.angled") {
            VStack(alignment: .leading, spacing: 10) {
                PhotosPicker(
                    selection: $photoSelection,
                    maxSelectionCount: 0,
                    matching: .images,
                    photoLibrary: .shared()
                ) {
                    HStack(spacing: 10) {
                        if isReadingPhotos {
                            ProgressView().tint(Theme.accent)
                        } else {
                            Image(systemName: "calendar.badge.plus").font(.title3).foregroundStyle(Theme.accent)
                        }
                        Text(isReadingPhotos ? "Reading photo dates…" : "Pick photos to propose days")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Theme.accent.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                    )
                }
                .disabled(isReadingPhotos)

                if photoDayCount > 0 {
                    Text("Grouped into \(photoDayCount) day(s) by capture date.")
                        .font(.caption2).foregroundStyle(Theme.textTertiary)
                }
                Text("Reads only capture dates + location to propose days. Add the actual photos after creating the journey.")
                    .font(.caption2).foregroundStyle(Theme.textTertiary)
            }
        }
    }

    /// Read each picked item's EXIF (date + GPS) without ingesting the bytes, cluster into days.
    /// Only seeds days when none exist yet, matching the route-import rule.
    private func seedDaysFromPhotos(_ items: [PhotosPickerItem]) async {
        isReadingPhotos = true
        defer { isReadingPhotos = false; photoSelection = [] }

        var probes: [Photo] = []
        var fixes: [PhotoFix] = []
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self), !data.isEmpty else { continue }
            let meta = ImageMetadata.extract(from: data)
            probes.append(Photo(id: UUID().uuidString, journeyId: draft.id, waypointId: nil,
                                url: "", thumbnailURL: nil, caption: nil,
                                coordinates: meta.coordinates, takenAt: meta.takenAt))
            // A usable fix needs both a coordinate and a capture instant.
            if let coords = meta.coordinates, coords.count >= 2,
               let takenAt = meta.takenAt, let date = PhotoDayMatcher.parseDate(takenAt) {
                fixes.append(PhotoFix(coordinate: coords, timestamp: date, altitude: meta.altitude))
            }
        }
        photoFixes = fixes
        let proposed = JourneyDraft.days(fromPhotos: probes)
        // Only claim "Grouped into N day(s)" when the proposal is actually applied — otherwise the
        // caption advertised days that were discarded because the user had already built a list.
        // (quality gate: replace route / photo-day-count shown even when discarded.)
        if draft.days.isEmpty || JourneyDraft.daysAreAllAutoSeeded(draft.days) {
            draft.days = proposed
            photoDayCount = proposed.count
        } else {
            photoDayCount = 0
        }
        await runSuggestions()
    }

    // MARK: Suggestions orchestration

    /// Kick off the suggestion providers for the current draft. Called only after the user has
    /// provided photos or a route — never on appear — so there are no ambient network calls. When a
    /// GPX route is present the photo fixes are not used for route inference (they'd duplicate it).
    private func runSuggestions() async {
        suggestions.factsEnabled = intelligence.isAvailable && entitlements.isComplete
        let fixes = draft.hasRoute ? [] : photoFixes
        await suggestions.run(fixes: fixes, draft: draft)
    }

    private func accept(_ key: SuggestionKey) {
        suggestions.accept(key, into: &draft)
        syncRouteSummaryFromDraft()
    }

    private func acceptAllSuggestions() {
        suggestions.acceptAll(into: &draft)
        syncRouteSummaryFromDraft()
    }

    /// Refresh the route summary card when the draft's route no longer matches it — after a
    /// route-from-photos suggestion is accepted, the points/distance must reflect the drafted route
    /// (and there are no GPX waypoints in that case).
    ///
    /// Keyed on the ROUTE having changed, not on which suggestion was accepted: `accept` is a no-op
    /// for a key that is no longer pending, and rebuilding on the key alone would drop a drawn
    /// route's provenance note while the drawn route was still there.
    private func syncRouteSummaryFromDraft() {
        guard let route = draft.route, !route.coordinates.isEmpty else { return }
        guard routeSummary?.pointCount != route.coordinates.count else { return }
        routeSummary = RouteSummary(
            pointCount: route.coordinates.count,
            distanceKm: JourneyDraft.totalDistanceKm(route: route.coordinates),
            waypointCount: 0,
            droppedCount: 0,
            drawnNote: nil)
    }

    // MARK: Suggestions

    /// The coherent "Suggestions" panel: rows appear as providers resolve, each with Accept /
    /// dismiss, plus a batch Accept all. Hidden entirely until something is pending or running, so
    /// it never shows an empty shell.
    @ViewBuilder
    private var suggestionsSection: some View {
        let pending = suggestions.model.pending
        if !pending.isEmpty || suggestions.isRunning {
            GlassField(label: "Suggestions", systemImage: "wand.and.stars") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        if suggestions.isRunning {
                            ProgressView().controlSize(.small).tint(Theme.accent)
                            Text("Looking for suggestions…")
                                .font(.caption).foregroundStyle(Theme.textTertiary)
                        }
                        Spacer()
                        if pending.count > 1 {
                            Button("Accept all", action: acceptAllSuggestions)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Theme.accent)
                        }
                    }
                    ForEach(pending, id: \.self) { key in
                        suggestionRow(key)
                    }
                    if pending.isEmpty && suggestions.isRunning {
                        Text("Reading photo locations, places and weather…")
                            .font(.caption2).foregroundStyle(Theme.textTertiary)
                    }
                }
            }
        }
    }

    private func suggestionRow(_ key: SuggestionKey) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(suggestions.title(for: key, in: draft))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                if let subtitle = suggestions.subtitle(for: key, in: draft), !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption2).foregroundStyle(Theme.textTertiary)
                        .lineLimit(2)
                }
            }
            Spacer()
            Button { suggestions.dismiss(key) } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textTertiary)
            }
            .buttonStyle(.plain)
            Button { accept(key) } label: {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent)
            }
            .buttonStyle(.plain)
        }
        .padding(10)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: Days

    private var daysSection: some View {
        GlassField(label: "Days (\(draft.days.count))", systemImage: "list.bullet.rectangle") {
            VStack(alignment: .leading, spacing: 10) {
                if draft.days.isEmpty {
                    Text("No days yet — import a GPX with waypoints, seed from photos, or add days below.")
                        .font(.caption).foregroundStyle(Theme.textTertiary)
                }
                if showsSuggestNames {
                    suggestNamesButton
                }
                ForEach(Array(draft.days.enumerated()), id: \.element.id) { index, _ in
                    dayRow(index: index, day: $draft.days[index])
                }
                Button(action: addDay) {
                    HStack(spacing: 8) {
                        Image(systemName: "plus.circle.fill").foregroundStyle(Theme.accent)
                        Text("Add day").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                        Spacer()
                    }
                    .padding(12)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func dayRow(index: Int, day: Binding<DraftDay>) -> some View {
        HStack(spacing: 10) {
            Text("\(index + 1)")
                .font(.caption.weight(.bold))
                .foregroundStyle(Theme.accent)
                .frame(width: 24, height: 24)
                .background(Theme.accentSoft, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                TextField("Day name", text: day.name)
                    .textFieldStyle(.plain)
                    .foregroundStyle(Theme.textPrimary)
                if let label = day.wrappedValue.dateLabel {
                    Text(label).font(.caption2).foregroundStyle(Theme.textTertiary)
                }
            }
            Spacer()
            Button { move(from: index, by: -1) } label: {
                Image(systemName: "chevron.up").foregroundStyle(index == 0 ? Theme.textTertiary : Theme.textSecondary)
            }
            .buttonStyle(.plain).disabled(index == 0)
            Button { move(from: index, by: 1) } label: {
                Image(systemName: "chevron.down")
                    .foregroundStyle(index == draft.days.count - 1 ? Theme.textTertiary : Theme.textSecondary)
            }
            .buttonStyle(.plain).disabled(index == draft.days.count - 1)
            Button { draft.days.remove(at: index) } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textTertiary)
            }
            .buttonStyle(.plain)
        }
        .padding(10)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    private func addDay() {
        draft.days.append(DraftDay(name: "Day \(draft.days.count + 1)", source: .manual))
    }

    // MARK: Suggest names with Apple Intelligence (M6)

    @ViewBuilder
    private var suggestNamesButton: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: suggestNames) {
                HStack(spacing: 8) {
                    if isSuggestingNames {
                        ProgressView().controlSize(.small).tint(Theme.accent)
                    } else {
                        Image(systemName: "apple.intelligence").foregroundStyle(Theme.accent)
                    }
                    Text(isSuggestingNames ? "Suggesting names…" : "Suggest names")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                    Spacer()
                }
                .padding(12)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(isSuggestingNames)
            if suggestNamesFailed {
                Text("Couldn't suggest names — try again")
                    .font(.caption2).foregroundStyle(Theme.textTertiary)
            }
        }
    }

    /// Generate one name per day and apply the results ONLY to days still carrying their
    /// auto-generated placeholder name — hand-edited days are never overwritten.
    private func suggestNames() {
        guard !isSuggestingNames, !draft.days.isEmpty else { return }
        suggestNamesFailed = false
        let facts = draft.days.enumerated().map { index, day in
            DayNameFacts(index: index, day: day)
        }
        // Capture the day IDENTITIES the facts were built from, so the results are applied by id —
        // not by list position. If the user deletes/reorders/adds a day while the model runs, each
        // surviving day still gets the name generated from its own facts.
        let capturedIDs = draft.days.map(\.id)
        isSuggestingNames = true
        Task {
            defer { isSuggestingNames = false }
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                do {
                    let suggestions = try await DayNamer.generate(for: facts)
                    guard !suggestions.isEmpty else { suggestNamesFailed = true; return }
                    draft.days = DayNamer.applying(suggestions: suggestions,
                                                   forDayIDs: capturedIDs, to: draft.days)
                } catch {
                    suggestNamesFailed = true
                }
            } else {
                suggestNamesFailed = true
            }
            #else
            suggestNamesFailed = true
            #endif
        }
    }

    private func move(from index: Int, by offset: Int) {
        let target = index + offset
        guard draft.days.indices.contains(index), draft.days.indices.contains(target) else { return }
        draft.days.swapAt(index, target)
    }

    // MARK: Create

    private func create() {
        guard draft.isValid, !isSaving else { return }
        // Defense in depth: the entry points pre-gate, but if this sheet is ever open while the
        // user is already at the free-journey limit, present the paywall instead of creating.
        guard entitlements.canCreateJourney(ownedCount: store.billableOwnedJourneyCount) else {
            showPaywall = true
            return
        }
        isSaving = true
        saveError = nil
        syncDates()
        guard let created = store.createJourney(from: draft) else {
            isSaving = false
            saveError = "Could not save the journey. Please try again."
            return
        }
        // Land the user in their new journey via the existing deep-link path (the globe observes
        // `pendingJourneySelection` and flies to it).
        store.requestJourneySelection(created.id)
        onCreated(created)
        dismiss()
    }
}
