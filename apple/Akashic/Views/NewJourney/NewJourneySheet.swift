import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Create a journey from scratch (§4.1) — the counterpart to the arrive-only import/sync paths.
///
/// One sheet with sections (basics → dates → route → photos → days), not a wizard. Route import
/// and photo-day-seeding are both optional: a journey with no route and no days is valid (a
/// photos-only trip). On create the journey is persisted through `JourneyStore.createJourney`
/// (which routes through the same Core Data seam sync observes), then the app flies into it.
struct NewJourneySheet: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @EnvironmentObject private var intelligence: Intelligence
    @Environment(\.dismiss) private var dismiss

    /// Called with the created journey after a successful save (so a presenter can dismiss its
    /// own container — e.g. the Journeys list sheet — and let the globe fly to it).
    var onCreated: (Journey) -> Void = { _ in }

    @State private var draft = JourneyDraft()
    @State private var hasStart = false
    @State private var startDate = Date()
    @State private var hasEnd = false
    @State private var endDate = Date()

    // Route import.
    @State private var showingImporter = false
    @State private var routeSummary: RouteSummary?
    @State private var importError: String?

    // Draw-on-map. The drawn route is stashed and applied on the sheet's dismissal, so the
    // suggestion pass never runs while a sheet is still on screen.
    @State private var showingDrawing = false
    @State private var drawnRoute: Route?

    // Photo day-seeding.
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var isReadingPhotos = false
    @State private var photoDayCount = 0

    @State private var isSaving = false
    @State private var saveError: String?
    @State private var showPaywall = false

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
        /// Hand-drawn routes carry no elevation — the summary says so instead of letting the user
        /// find out from empty ascent/summit stats later.
        var isDrawn: Bool = false
    }

    var body: some View {
        EditSheetScaffold(
            title: "New Journey",
            saveTitle: "Create",
            saveDisabled: !draft.isValid || isSaving || isReadingPhotos,
            isSaving: isSaving,
            onCancel: { dismiss() },
            onSave: create
        ) {
            basicsSection
            datesSection
            routeSection
            photosSection
            suggestionsSection
            daysSection
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
        .onChange(of: photoSelection) { _, items in
            guard !items.isEmpty else { return }
            Task { await seedDaysFromPhotos(items) }
        }
    }

    // MARK: Basics

    private var basicsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            GlassField(label: "Name", systemImage: "flag") {
                GlassTextField(placeholder: "e.g. Kilimanjaro — Lemosho Route", text: $draft.name)
            }
            GlassField(label: "Country", systemImage: "globe") {
                GlassTextField(placeholder: "Country", text: $draft.country)
            }
            GlassField(label: "Description", systemImage: "text.alignleft") {
                GlassTextEditor(text: $draft.description, minHeight: 90)
            }
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
                    if summary.isDrawn {
                        Text(RouteDrawing.elevationNote)
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
                                  fallbackCenter: drawingCenter) { route in
                    drawnRoute = route
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

    /// Parse the picked GPX OFF the main actor (whole-file `Data` load + full XML pass), then apply
    /// the result on the main actor. Keeping the parse off the main thread stops a large file from
    /// freezing the UI. The security-scoped access is held across the `await`.
    @MainActor
    private func parseRoute(from url: URL) async {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        do {
            let file = try await Task.detached(priority: .userInitiated) {
                try GPXParser.parse(contentsOf: url)
            }.value
            draft.route = file.route
            routeSummary = RouteSummary(
                pointCount: file.trackPointCount,
                distanceKm: JourneyDraft.totalDistanceKm(route: file.route.coordinates),
                waypointCount: file.waypoints.count,
                droppedCount: file.droppedPointCount)
            // Reseed days from the new file when the current list is still entirely auto-proposed
            // (an unedited first import, e.g. the wrong file) — otherwise the previous file's days
            // would linger while the summary advertised the new file's waypoints. A day list the
            // user has actually worked on is never clobbered.
            if draft.days.isEmpty || JourneyDraft.daysAreAllAutoSeeded(draft.days) {
                draft.days = JourneyDraft.days(fromWaypoints: file.waypoints)
            }
            // A route + days now exist — offer country / camp names / weather / POIs / facts.
            await runSuggestions()
        } catch {
            importError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: Draw on map

    /// Where the drawing map opens when there is no route yet: the first placed day, else the first
    /// geotagged photo from the pick. Nil opens on the world.
    private var drawingCenter: [Double]? {
        if let placed = draft.days.first(where: { $0.coordinates.count >= 2 })?.coordinates {
            return placed
        }
        return photoFixes.first?.coordinate
    }

    /// Apply a route drawn in the sheet, once that sheet is gone. Days are untouched — a drawn route
    /// carries no waypoints, so there is nothing to seed from and nothing to clobber.
    private func applyDrawnRoute() {
        guard let route = drawnRoute else { return }
        drawnRoute = nil
        draft.route = route
        routeSummary = RouteSummary(
            pointCount: route.coordinates.count,
            distanceKm: JourneyDraft.totalDistanceKm(route: route.coordinates),
            waypointCount: 0,
            droppedCount: 0,
            isDrawn: true)
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
        // A route suggestion accepted on top of a drawn route replaces it, so the summary must be
        // rebuilt (its point count, distance and no-elevation note all belonged to the old route).
        syncRouteSummaryFromDraft(force: key == .routeFromPhotos)
    }

    private func acceptAllSuggestions() {
        let replacesRoute = suggestions.model.pending.contains(.routeFromPhotos)
        suggestions.acceptAll(into: &draft)
        syncRouteSummaryFromDraft(force: replacesRoute)
    }

    /// Refresh the route summary card after a route-from-photos suggestion is accepted, so the
    /// points/distance reflect the drafted route (there are no GPX waypoints in that case).
    private func syncRouteSummaryFromDraft(force: Bool = false) {
        guard force || routeSummary == nil,
              let route = draft.route, !route.coordinates.isEmpty else { return }
        routeSummary = RouteSummary(
            pointCount: route.coordinates.count,
            distanceKm: JourneyDraft.totalDistanceKm(route: route.coordinates),
            waypointCount: 0,
            droppedCount: 0)
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
