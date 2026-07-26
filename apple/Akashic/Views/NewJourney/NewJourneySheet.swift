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

    // C4: dates row. `hasStart`/`startDate`/`hasEnd`/`endDate` back the EXPANDED editor only
    // (seeded from `draft.dateStarted`/`dateEnded` when the user taps Edit — see
    // `beginEditingDates()`); the collapsed row reads `draft.dateStarted`/`dateEnded` directly, since
    // those may have arrived by auto-derivation and never gone through the editor at all.
    @State private var isEditingDates = false
    @State private var hasStart = false
    @State private var startDate = Date()
    @State private var hasEnd = false
    @State private var endDate = Date()
    /// True the moment the user commits an edit in the expanded date pickers. Mirrors the
    /// route/country "structural but reversible" rule: dates are derived and re-derived automatically
    /// as more photos/GPX data arrive, right up until the user's own edit — which always wins, forever.
    @State private var datesTouched = false
    /// Caption under the collapsed dates row ("from your photos" / "from your GPX file") — nil once
    /// nothing was derived, or once the user has taken over via `datesTouched`.
    @State private var datesProvenance: String?

    // Route import (review screen's own re-import / replace).
    @State private var showingImporter = false
    @State private var routeSummary: RouteSummary?
    @State private var importError: String?
    /// C3: whether the route currently on the draft is the one applied automatically from photo
    /// inference (vs. GPX/hand-drawn) — drives which of the two route displays `routeSection` shows.
    /// Cleared the moment a GPX import or a drawn route replaces it.
    @State private var routeAppliedFromPhotos = false
    /// C6: the user tapped "Skip" on `DraftMapCard`'s photos-lacked-GPS nudge — stays quiet for the
    /// rest of this sheet's lifetime rather than repeating the same nudge on every scroll back up.
    @State private var routeNudgeDismissed = false

    // Draw-on-map. The drawing is stashed and applied on the sheet's dismissal, so the
    // suggestion pass never runs while a sheet is still on screen.
    @State private var showingDrawing = false
    @State private var drawnRoute: RouteDrawing.DrawnRoute?

    // Photo staging + day-seeding (C2 — see apple/Docs/DESIGN-PLAN.md). Each picked item is
    // ingested (files written + EXIF read) through the SAME `PhotoIngestService` pass that lands
    // it on the journey at create — never loaded twice, never thrown away.
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var stagedPhotos: [Photo] = []
    @State private var isStagingPhotos = false
    @State private var photoStageTotal = 0
    @State private var photoStageDone = 0
    @State private var photoDayCount = 0

    @State private var isSaving = false
    @State private var saveError: String?
    @State private var showPaywall = false
    /// The created journey, once `create()` succeeds — kept around only so a partial photo import
    /// (below) can hold the review screen open long enough for its banner to be seen before flying
    /// to it. `nil` the whole time for the common case (no cap hit).
    @State private var createdJourney: Journey?
    /// Files already handed to `JourneyStore.addIngestedPhotos` — `onDisappear`/`cancel` must NOT
    /// delete these. Mirrors `PhotoImportSheet`'s `committed` flag exactly.
    @State private var committed = false
    /// After a partial import (free tier, over the per-journey photo cap): how many staged photos
    /// were left out.
    @State private var partialRemainder = 0
    @State private var showPhotoPaywall = false
    /// Set by `cancel()`/cleanup so an ingest batch already in flight (each item is `await`ed one
    /// at a time) stops handing new photos to `stagedPhotos` and instead deletes them the instant
    /// they land — otherwise a cancel mid-pick could leave the tail of the batch orphaned on disk.
    @State private var stagingCancelled = false

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
    /// C3: true once a suggested country has actually been written into `draft.country` — drives the
    /// "suggested" caption under the field. Cleared the instant the user edits the field themselves
    /// (via `countryBinding` below), regardless of what they type.
    @State private var countrySuggested = false

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

        /// C5: `DraftMapCard`'s single provenance line for a GPX/drawn route. A drawn route's own
        /// `drawnNote` already carries `RouteDrawing.DrawnRoute.summary` plus
        /// `RouteDrawing.elevationNote` (built once, where the provenance is known — see
        /// `applyDrawnRoute` — rather than re-derived here); otherwise this is the GPX
        /// points/distance/waypoints/dropped stats, in the same house style as
        /// `RouteConfidence.summary` and `RouteDrawing.DrawnRoute.summary`.
        var provenanceLine: String {
            if let drawnNote { return drawnNote }
            // Each count is its own plural-varied catalogue entry, joined with the middot. The
            // previous form appended "s" inline, which is English-only morphology hardcoded into
            // a view model where no translation could reach it.
            var s = String(localized: "\(pointCount) route points",
                           comment: "GPX route provenance: how many coordinates the track holds.")
                  + " · \(Formatters.distanceKm(distanceKm))"
                  + " · " + String(localized: "\(waypointCount) waypoints",
                                   comment: "GPX route provenance: how many waypoints became days.")
            if droppedCount > 0 {
                s += " · " + String(localized: "\(droppedCount) skipped",
                                    comment: "GPX route provenance: coordinates dropped as unusable.")
            }
            return s
        }
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
        // C4: the file's own waypoint/metadata times are as good a date signal as a GPX picked from
        // the review screen's own importer — no reason this entry point should land without them.
        var provenance: String?
        if let range = JourneyDraft.dateRange(fromGPX: file) {
            draft.dateStarted = range.start
            draft.dateEnded = range.end
            provenance = String(localized: "from your GPX file",
                                comment: "Caption under the dates row when the dates came from an imported GPX track.")
        }
        _draft = State(initialValue: draft)
        _routeSummary = State(initialValue: applied.summary)
        _datesProvenance = State(initialValue: provenance)
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
                    onCancel: cancel)
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
        // Catches every way the sheet can go away that ISN'T the explicit Cancel button (swipe-
        // to-dismiss, the presenting view tearing down) — same `committed` guard as `cancel()` so
        // a successful create is never undone.
        .onDisappear {
            store.isPresentingJourneyCreation = false
            guard !committed else { return }
            stagingCancelled = true
            cleanupStagedPhotos()
        }
        // Marks the shared "a creation flow is up" flag every one of the three entry points (list
        // "+", globe "+", opened `.gpx`) shares — each entry point only knows about its OWN sheet
        // presentation state, so this is the one place visible to all three. `AkashicApp` reads it
        // before presenting the review sheet for a newly-opened `.gpx`, so a second file opened
        // while any of them is already up can never silently swap out and discard the user's draft.
        .onAppear {
            store.isPresentingJourneyCreation = true
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
            // Once a (possibly partial) photo import has already landed, there is nothing left to
            // save — "Done" just navigates, same as tapping through `PhotoImportSheet`'s own banner.
            saveTitle: createdJourney == nil ? "Create" : "Done",
            saveDisabled: createdJourney == nil && (!draft.isValid || isSaving || isStagingPhotos),
            isSaving: isSaving,
            onCancel: cancel,
            onSave: createdJourney == nil ? create : finishAfterPartialImport
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
        .sheet(isPresented: $showPhotoPaywall) {
            PaywallView(reason: .photoLimit(remaining: partialRemainder))
                .environmentObject(entitlements)
        }
        .fileImporter(isPresented: $showingImporter,
                      allowedContentTypes: gpxContentTypes,
                      allowsMultipleSelection: false,
                      onCompletion: handleImport)
    }

    // MARK: Name

    /// C4: the Description section that used to sit here is gone from creation — it's the classic
    /// field that stalls completion, and `JourneyEditSheet` already edits description after the fact.
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
            // C3: a one-tap name suggestion once we know the country and the trip's first dated day
            // — "Use \"Tanzania, September 2023\"". `JourneyDraft.nameSuggestion` itself guards on the
            // name being empty, so this chip is simply absent (never fires) once the user has typed
            // anything, without this call site needing to duplicate that check.
            if let suggestion = nameSuggestion {
                Button {
                    draft.name = suggestion
                } label: {
                    Label("Use \"\(suggestion)\"", systemImage: "sparkles")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var nameSuggestion: String? {
        JourneyDraft.nameSuggestion(currentName: draft.name, country: draft.country,
                                    firstDayDateLabel: draft.days.first?.dateLabel)
    }

    // MARK: Country

    private var countrySection: some View {
        GlassField(label: "Country", systemImage: "globe") {
            VStack(alignment: .leading, spacing: 4) {
                GlassTextField(placeholder: "Country", text: countryBinding)
                // C3: country is structural (from the route/photo centroid) and applied directly —
                // this caption is the "visibly" half of "applied by default, visibly, reversibly".
                // Reversal is just editing the field, which is why there's no separate Remove here
                // (unlike the route, which has no in-place editable representation).
                if countrySuggested {
                    Text("Suggested from your route")
                        .font(.caption2).foregroundStyle(Theme.textTertiary)
                }
            }
        }
    }

    /// Intercepts every WRITE the text field makes (but not our own `draft.country = ...` assignments,
    /// which bypass this binding entirely) so a real keystroke — even one that leaves the field
    /// looking unchanged — retires the "suggested" caption immediately.
    private var countryBinding: Binding<String> {
        Binding(
            get: { draft.country },
            set: { newValue in
                draft.country = newValue
                countrySuggested = false
            })
    }

    // MARK: Dates (C4 — one derived row + an Edit affordance, replacing the two toggle+picker rows)

    private var datesSection: some View {
        GlassField(label: "Dates", systemImage: "calendar.badge.clock") {
            VStack(alignment: .leading, spacing: 10) {
                if isEditingDates {
                    VStack(spacing: 10) {
                        dateRow(label: "Start", isOn: $hasStart, date: $startDate)
                        dateRow(label: "End", isOn: $hasEnd, date: $endDate)
                    }
                    .padding(12)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
                    Button("Done") { isEditingDates = false }
                        .font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
                } else {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(datesSummary)
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                            if let datesProvenance {
                                Text(datesProvenance).font(.caption2).foregroundStyle(Theme.textTertiary)
                            }
                        }
                        Spacer()
                        Button("Edit", action: beginEditingDates)
                            .font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
                    }
                }
            }
        }
    }

    /// "29 Sep – 9 Oct 2023", a single date, or "Add dates" when neither end is set — same wording
    /// `Formatters.dateRange` already uses elsewhere for a journey's dates.
    private var datesSummary: String {
        Formatters.dateRange(DateOnly.string(from: draft.dateStarted), DateOnly.string(from: draft.dateEnded))
            ?? String(localized: "Add dates",
                      comment: "New journey: the collapsed dates row when neither end is set.")
    }

    /// Seed the expanded editor from whatever the draft currently holds — including a derived range
    /// the user never touched — so "Edit" refines a starting point instead of opening blank.
    private func beginEditingDates() {
        hasStart = draft.dateStarted != nil
        startDate = draft.dateStarted ?? Date()
        hasEnd = draft.dateEnded != nil
        endDate = draft.dateEnded ?? Date()
        isEditingDates = true
    }

    private func dateRow(label: LocalizedStringKey, isOn: Binding<Bool>, date: Binding<Date>) -> some View {
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
        .onChange(of: isOn.wrappedValue) { _, _ in userEditedDates() }
        .onChange(of: date.wrappedValue) { _, _ in userEditedDates() }
    }

    /// The ONLY path that writes `draft.dateStarted`/`dateEnded` from the expanded editor — and the
    /// one that permanently stops auto-derivation from overwriting them (`datesTouched`), same
    /// discipline as `countryBinding`. The provenance caption goes with it: once the user is the
    /// author, "from your photos" is no longer true.
    private func userEditedDates() {
        datesTouched = true
        datesProvenance = nil
        draft.dateStarted = hasStart ? startDate : nil
        draft.dateEnded = hasEnd ? endDate : nil
    }

    // MARK: Route (C5 — map preview card; GPX import / draw on map live in its Route options menu)

    /// C5/C6: `DraftMapCard` is the entire "Route" field now — the map, the honest provenance line
    /// (whichever source produced the route), the Route options menu, and (when nothing has been
    /// drafted yet) either the quiet placeholder or C6's photos-lacked-GPS nudge. `importError`
    /// stays outside the card because it can arrive from EITHER the menu's "Replace with GPX" or
    /// the nudge's "Import GPX" — one place to show a typed `GPXParseError`, not two.
    private var routeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            DraftMapCard(
                route: draft.route,
                days: draft.days,
                provenance: routeProvenanceText,
                photosLackedGPS: photosLackedGPSForRoute,
                nudgeDismissed: routeNudgeDismissed,
                onImportGPX: {
                    importError = nil
                    showingImporter = true
                },
                onDrawOnMap: {
                    importError = nil
                    showingDrawing = true
                },
                onRemoveRoute: removeRoute,
                onSkipRouteNudge: { routeNudgeDismissed = true }
            )
            if let importError {
                Text(importError).font(.footnote).foregroundStyle(Theme.warning)
            }
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

    /// C5: the map card's single provenance line — the photo-inference confidence line takes
    /// priority (it is the one provenance the card cannot derive from `routeSummary` alone, since
    /// C3 applies it without ever populating a GPX/drawn `RouteSummary`); otherwise whatever
    /// `routeSummary` itself carries (GPX stats, or a drawn route's own note).
    private var routeProvenanceText: String? {
        if routeAppliedFromPhotos, let confidence = suggestions.routeResult?.confidence {
            return confidence.summary
        }
        return routeSummary?.provenanceLine
    }

    /// C6: photos were picked and days were proposed from their capture dates, but not one of them
    /// carried a usable GPS fix — distinct from a route that arrived and was then explicitly
    /// removed, and from a photo pick that seeded no days at all (that's `photosHadNoReadableDates`
    /// below, a different failure with different copy). Turns off the moment any route lands
    /// (GPX/drawn), which is exactly the "fully creatable, never a dead end" contract.
    private var photosLackedGPSForRoute: Bool {
        !draft.hasRoute && !stagedPhotos.isEmpty && photoDayCount > 0 && photoFixes.isEmpty
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
        // The route's provenance is GPX now, not photo inference — even if a prior photo-drafted
        // route is what's being replaced.
        routeAppliedFromPhotos = false
        applyDatesFromGPXIfUntouched(file)
    }

    /// C4: the file's own waypoint/metadata times, while the user hasn't taken over the dates row
    /// (`datesTouched`) — independent of whether `applyImportedGPX` actually reseeded the day list
    /// above, since a file's dates are honest information about the trip even when the user's own
    /// day list is kept as-is.
    private func applyDatesFromGPXIfUntouched(_ file: GPXFile) {
        guard !datesTouched, let range = JourneyDraft.dateRange(fromGPX: file) else { return }
        draft.dateStarted = range.start
        draft.dateEnded = range.end
        datesProvenance = String(localized: "from your GPX file",
                                 comment: "Caption under the dates row when the dates came from an imported GPX track.")
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
        // A hand-drawn route carries no dates or capture times — only its provenance changes here.
        routeAppliedFromPhotos = false
        // A route now exists — offer country / camp names / weather / POIs / facts, exactly as an
        // imported GPX does.
        Task { await runSuggestions() }
    }

    /// C3: "Remove" on the route drafted from photos. There's no in-place editable representation of
    /// a route the way there is for country, so this button is the reversible half of "applied by
    /// default, visibly, reversibly".
    private func removeRouteFromPhotos() {
        suggestions.removeRouteFromPhotos(from: &draft)
        routeAppliedFromPhotos = false
    }

    /// C5: `DraftMapCard`'s "Remove route" menu item — reachable regardless of provenance. A
    /// photo-inferred route has its own idempotent removal (so a later suggestion re-run, e.g. after
    /// picking more photos, can never bring it back); a GPX/drawn route has no such state to retire,
    /// so clearing the draft and its summary directly is enough.
    private func removeRoute() {
        if routeAppliedFromPhotos {
            removeRouteFromPhotos()
        } else {
            draft.route = nil
            routeSummary = nil
        }
    }

    // MARK: Photos (stage via PhotoIngestService, cluster from the SAME ingested photos)

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
                        if isStagingPhotos {
                            ProgressView().tint(Theme.accent)
                        } else {
                            Image(systemName: "calendar.badge.plus").font(.title3).foregroundStyle(Theme.accent)
                        }
                        Text(photoPickerLabel)
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
                .disabled(isStagingPhotos)

                if isStagingPhotos {
                    ProgressView(value: Double(photoStageDone), total: Double(max(photoStageTotal, 1)))
                        .tint(Theme.accent)
                }
                if !stagedPhotos.isEmpty {
                    Text(stagedPhotosSummary)
                        .font(.caption2).foregroundStyle(Theme.textTertiary)
                }
                if partialRemainder > 0 {
                    partialImportBanner
                }
                Text("Reads capture dates, location and the photos themselves — they're added to the journey, on the day they belong to, the moment you create it.")
                    .font(.caption2).foregroundStyle(Theme.textTertiary)
            }
        }
    }

    /// `LocalizedStringKey`, not `String`. As a `String` these three literals were handed to
    /// `Text` already-resolved, so they never entered the catalogue — the silent half of QUA-06.
    private var photoPickerLabel: LocalizedStringKey {
        if isStagingPhotos { return "Preparing photos… \(photoStageDone) of \(photoStageTotal)" }
        return stagedPhotos.isEmpty ? "Pick photos to propose days" : "Pick more photos"
    }

    private var stagedPhotosSummary: String {
        // Both counts are plural-varied in the catalogue. The day count in particular used to read
        // "grouped into 3 day(s)" — the parenthesised "(s)" that English writers reach for when
        // they have not decided, and which no other language can even imitate.
        let base = String(localized: "\(stagedPhotos.count) photos ready",
                          comment: "New journey: how many picked photos are staged and ready to import.")
        guard photoDayCount > 0 else { return base }
        let grouped = String(localized: "grouped into \(photoDayCount) days by capture date",
                             comment: "New journey: appended to the staged-photo count when capture dates produced days.")
        return "\(base) · \(grouped)"
    }

    /// Shown after a free-tier partial import: what landed, what didn't, and the way to unlock the
    /// rest. Never a silent drop — the remainder is always named. Copied verbatim from
    /// `PhotoImportSheet`'s banner (same contract, same wording) rather than inventing a second one.
    private var partialImportBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("\(partialRemainder) photos couldn't be added",
                  systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.warning)
            Text("The free tier holds up to \(EntitlementPolicy.freePhotosPerOwnedJourney) photos per journey. We added the ones that fit. Akashic Complete lifts the cap so the rest can come too.")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            Button {
                showPhotoPaywall = true
            } label: {
                Label("Unlock with Akashic Complete", systemImage: "star.circle")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.accent)
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    /// Stage each picked item through `PhotoIngestService.ingest(pickerItem:journeyId:sortOrder:)`,
    /// keyed to `draft.id` — minted up front precisely so files ingested before create already key
    /// to it — then derive EXIF fixes (for route inference) and day clusters from those SAME
    /// ingested photos. This used to load every photo's bytes twice: once here to probe EXIF
    /// (discarding the bytes immediately after), and again after the journey existed, when the
    /// caption told the user to pick the same photos again. That double-load-then-discard was the
    /// C2 defect — a family experiences it as the app losing their photos.
    ///
    /// Only (re)seeds days when the current list is still fully auto-proposed, matching the
    /// route-import rule; clustering runs over ALL staged photos so far (not just this batch), so a
    /// second pick still produces one consistent day list and one consistent assignment set.
    private func seedDaysFromPhotos(_ items: [PhotosPickerItem]) async {
        isStagingPhotos = true
        photoStageTotal = items.count
        photoStageDone = 0
        defer {
            isStagingPhotos = false
            photoSelection = []
            photoStageTotal = 0
            photoStageDone = 0
        }

        let service = PhotoIngestService()
        var order = stagedPhotos.count
        for item in items {
            if let photo = try? await service.ingest(pickerItem: item, journeyId: draft.id, sortOrder: order) {
                if stagingCancelled {
                    // The sheet was cancelled while this item was still loading — its bytes were
                    // just written, so delete them immediately rather than leaving them orphaned.
                    PhotoEditService().deleteFiles(for: photo)
                } else {
                    stagedPhotos.append(photo)
                    order += 1
                }
            }
            photoStageDone += 1
        }
        guard !stagingCancelled else { return }

        // Route-inference fixes come from the SAME ingested photos — no altitude (`Photo` doesn't
        // persist EXIF altitude; `RouteInference` degrades gracefully to a 2D route without it).
        photoFixes = stagedPhotos.compactMap { photo in
            guard let coords = photo.coordinates, coords.count >= 2,
                  let takenAt = photo.takenAt, let date = PhotoDayMatcher.parseDate(takenAt)
            else { return nil }
            return PhotoFix(coordinate: coords, timestamp: date)
        }

        let (proposed, assignments) = JourneyDraft.daysWithAssignments(fromPhotos: stagedPhotos)
        // Only claim "Grouped into N day(s)" when the proposal is actually applied — otherwise the
        // caption advertised days that were discarded because the user had already built a list.
        // (quality gate: replace route / photo-day-count shown even when discarded.)
        if draft.days.isEmpty || JourneyDraft.daysAreAllAutoSeeded(draft.days) {
            draft.days = proposed
            photoDayCount = proposed.count
            for index in stagedPhotos.indices {
                stagedPhotos[index].waypointId = assignments[stagedPhotos[index].id]
            }
            // C4: the trip's own capture dates, from the SAME clusters that just seeded the days —
            // before `runSuggestions()`, so a fresh `dateStarted` is already there to feed the
            // weather providers it's about to kick off.
            applyDatesFromPhotosIfUntouched()
        } else {
            photoDayCount = 0
        }
        await runSuggestions()
    }

    /// C4: fill dates from the day list just clustered from photos, while the user hasn't touched
    /// the dates row (`datesTouched`) — runs on every re-seed, so picking MORE photos can extend an
    /// already-derived range, right up until the user edits it (permanent, via `userEditedDates`).
    private func applyDatesFromPhotosIfUntouched() {
        guard !datesTouched, let range = JourneyDraft.dateRange(fromDays: draft.days) else { return }
        draft.dateStarted = range.start
        draft.dateEnded = range.end
        datesProvenance = String(localized: "from your photos",
                                 comment: "Caption under the dates row when the dates came from photo capture dates.")
    }

    // MARK: Suggestions orchestration

    /// Kick off the suggestion providers for the current draft. Called only after the user has
    /// provided photos or a route — never on appear — so there are no ambient network calls. When a
    /// GPX route is present the photo fixes are not used for route inference (they'd duplicate it).
    private func runSuggestions() async {
        suggestions.factsEnabled = intelligence.isAvailable && entitlements.isComplete
        let fixes = draft.hasRoute ? [] : photoFixes
        await suggestions.run(fixes: fixes, draft: draft)
        applyStructuralSuggestions()
    }

    /// C3: the suggestions that are STRUCTURAL facts about the user's OWN data — applied here,
    /// directly, every time the providers run, rather than waiting for a tap on an Accept row (that
    /// row still exists, and is still how ENRICHMENT — weather/POIs/facts/camp names — works, in
    /// `suggestionsSection` below). Route and country each guard themselves against re-applying
    /// (route via `routeFromPhotosState`'s pending/dismissed idempotence; country via `model`'s own
    /// accept-once idempotence plus its empty-field check), so calling this after every run is safe.
    private func applyStructuralSuggestions() {
        if suggestions.applyRouteFromPhotos(into: &draft) {
            routeAppliedFromPhotos = true
        }
        if suggestions.model.isPending(.country) {
            let before = draft.country
            accept(.country)
            if draft.country != before { countrySuggested = true }
        }
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
        // C3: `.country` is excluded here even though it still lives in the shared `model` (unlike
        // route) — `applyStructuralSuggestions()` auto-accepts it the instant `run()` finishes, but
        // for the brief window while OTHER providers are still resolving it could otherwise flash
        // into view as a pending Accept row. Filtering defends against that without changing what
        // `model` itself records.
        let pending = suggestions.model.pending.filter { $0 != .country }
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

    /// C6: the empty-days caption is context-specific where the reason is knowable, rather than one
    /// generic sentence for every "no days" cause.
    private var daysEmptyMessage: LocalizedStringKey {
        if gpxHadNoWaypoints {
            return "This file had no waypoints, so no days were proposed — add days, or pick photos to propose them."
        }
        if photosHadNoReadableDates {
            return "We couldn't read dates from these photos. They'll be added to the journey; you can build days later."
        }
        return "No days yet — import a GPX with waypoints, seed from photos, or add days below."
    }

    /// C6: a GPX file contributed a track (so `draft.hasRoute`) but no waypoints — the specific
    /// reason no days were proposed from it, as opposed to a drawn route (which never carries
    /// waypoints and isn't this failure) or a photo-inferred one (`routeAppliedFromPhotos`, excluded
    /// so this can't misfire while that route's own days — or lack of them — are the real story).
    private var gpxHadNoWaypoints: Bool {
        draft.hasRoute && draft.days.isEmpty && !routeAppliedFromPhotos
            && routeSummary?.drawnNote == nil && routeSummary?.waypointCount == 0
    }

    /// C6: photos were staged but none carried a readable capture date, so `seedDaysFromPhotos`
    /// clustered zero days — as opposed to a day list the user had already built, which that same
    /// pass deliberately leaves alone (see `seedDaysFromPhotos`'s doc comment). Distinguishable
    /// because THAT case never leaves `draft.days` empty in the first place.
    private var photosHadNoReadableDates: Bool {
        !stagedPhotos.isEmpty && draft.days.isEmpty && photoDayCount == 0
    }

    private var daysSection: some View {
        GlassField(label: "Days (\(draft.days.count))", systemImage: "list.bullet.rectangle") {
            VStack(alignment: .leading, spacing: 10) {
                if draft.days.isEmpty {
                    Text(daysEmptyMessage)
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
            Button { removeDay(at: index) } label: {
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

    /// Remove a day, then unassign (never delete) any staged photo that pointed at it — the day was
    /// only a proposal; the photos the user picked are not.
    private func removeDay(at index: Int) {
        guard draft.days.indices.contains(index) else { return }
        draft.days.remove(at: index)
        stagedPhotos = JourneyDraft.unassignPhotos(stagedPhotos, keeping: draft.days)
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
        guard draft.isValid, !isSaving, createdJourney == nil else { return }
        // Defense in depth: the entry points pre-gate, but if this sheet is ever open while the
        // user is already at the free-journey limit, present the paywall instead of creating.
        guard entitlements.canCreateJourney(ownedCount: store.billableOwnedJourneyCount) else {
            showPaywall = true
            return
        }
        isSaving = true
        saveError = nil
        // No `syncDates()` here (C4 removed it): `draft.dateStarted`/`dateEnded` are already live —
        // either derived automatically or kept current by `userEditedDates()` on every picker change.
        guard let created = store.createJourney(from: draft) else {
            isSaving = false
            saveError = String(localized: "Could not save the journey. Please try again.",
                               comment: "New journey sheet: shown when the save fails.")
            return
        }
        isSaving = false
        commitStagedPhotos(to: created)
    }

    /// Land the staged photos on the just-created journey, capped by the free-tier per-journey
    /// photo limit — a brand-new journey is always owned and starts at zero photos, so the math is
    /// simpler than `PhotoImportSheet`'s (no existing count to add to), but the over-cap branch
    /// copies its contract exactly: import what fits, delete the rest's staged files, and name the
    /// remainder via the same banner + paywall CTA. Never a silent drop.
    private func commitStagedPhotos(to journey: Journey) {
        let allowed = entitlements.photosAllowed(currentCount: 0, adding: stagedPhotos.count, isOwned: true)
        guard allowed < stagedPhotos.count else {
            // Nothing staged, or everything fits — the original path.
            if !stagedPhotos.isEmpty { store.addIngestedPhotos(stagedPhotos) }
            committed = true
            finish(journey)
            return
        }

        let keep = Array(stagedPhotos.prefix(allowed))
        let drop = Array(stagedPhotos.suffix(stagedPhotos.count - allowed))
        let service = PhotoEditService()
        for photo in drop { service.deleteFiles(for: photo) }
        if !keep.isEmpty { store.addIngestedPhotos(keep) }
        committed = true
        stagedPhotos = []
        partialRemainder = drop.count
        // Hold the review screen open (as `PhotoImportSheet` does) so the banner above is actually
        // seen before flying to the new journey — "Done" replaces "Create" once this is set.
        createdJourney = journey
    }

    /// Land the user in their new journey via the existing deep-link path (the globe observes
    /// `pendingJourneySelection` and flies to it).
    private func finish(_ journey: Journey) {
        store.requestJourneySelection(journey.id)
        onCreated(journey)
        dismiss()
    }

    /// "Done" after a partial import already showed its banner — the journey exists and everything
    /// that could be saved already was, so this just navigates.
    private func finishAfterPartialImport() {
        guard let createdJourney else { return }
        finish(createdJourney)
    }

    // MARK: Cancel / cleanup

    /// Delete every staged file — a photo picked here but never committed must never linger on
    /// disk. Copies `PhotoImportSheet`'s cleanup contract exactly.
    private func cancel() {
        stagingCancelled = true
        cleanupStagedPhotos()
        dismiss()
    }

    private func cleanupStagedPhotos() {
        let service = PhotoEditService()
        for photo in stagedPhotos { service.deleteFiles(for: photo) }
        stagedPhotos = []
    }
}
