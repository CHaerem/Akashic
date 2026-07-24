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

    // Photo day-seeding.
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var isReadingPhotos = false
    @State private var photoDayCount = 0

    @State private var isSaving = false
    @State private var saveError: String?
    @State private var showPaywall = false

    private struct RouteSummary: Equatable {
        var pointCount: Int
        var distanceKm: Double
        var waypointCount: Int
        var droppedCount: Int
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

    // MARK: Route (GPX import)

    private var routeSection: some View {
        GlassField(label: "Route", systemImage: "point.topleft.down.to.point.bottomright.curvepath") {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    importError = nil
                    showingImporter = true
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "arrow.down.doc").font(.title3).foregroundStyle(Theme.accent)
                        Text(routeSummary == nil ? "Import route (GPX)" : "Replace route")
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
                }
                if let importError {
                    Text(importError).font(.footnote).foregroundStyle(Theme.warning)
                }
                Text("GPX from Strava, Garmin, AllTrails or komoot. No route is fine too.")
                    .font(.caption2).foregroundStyle(Theme.textTertiary)
            }
        }
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
            let didAccess = url.startAccessingSecurityScopedResource()
            defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
            do {
                let file = try GPXParser.parse(contentsOf: url)
                draft.route = file.route
                routeSummary = RouteSummary(
                    pointCount: file.trackPointCount,
                    distanceKm: JourneyDraft.totalDistanceKm(route: file.route.coordinates),
                    waypointCount: file.waypoints.count,
                    droppedCount: file.droppedPointCount)
                // Seed days from the route's waypoints, but only when the user hasn't built any
                // days yet — never clobber a day list they've already edited.
                if draft.days.isEmpty, !file.waypoints.isEmpty {
                    draft.days = JourneyDraft.days(fromWaypoints: file.waypoints)
                }
            } catch {
                importError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
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
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self), !data.isEmpty else { continue }
            let meta = ImageMetadata.extract(from: data)
            probes.append(Photo(id: UUID().uuidString, journeyId: draft.id, waypointId: nil,
                                url: "", thumbnailURL: nil, caption: nil,
                                coordinates: meta.coordinates, takenAt: meta.takenAt))
        }
        let proposed = JourneyDraft.days(fromPhotos: probes)
        photoDayCount = proposed.count
        if draft.days.isEmpty { draft.days = proposed }
    }

    // MARK: Days

    private var daysSection: some View {
        GlassField(label: "Days (\(draft.days.count))", systemImage: "list.bullet.rectangle") {
            VStack(alignment: .leading, spacing: 10) {
                if draft.days.isEmpty {
                    Text("No days yet — import a GPX with waypoints, seed from photos, or add days below.")
                        .font(.caption).foregroundStyle(Theme.textTertiary)
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
        guard entitlements.canCreateJourney(ownedCount: store.ownedJourneyCount) else {
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
