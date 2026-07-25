import SwiftUI

/// Journey detail: header, inline route map, stats summary, and a per-day list.
struct JourneyDetailView: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @EnvironmentObject private var intelligence: Intelligence
    @Environment(\.dismiss) private var dismiss
    let journey: Journey

    /// Which day (index into `camps`) is shown in the presented `DayDetailSheet`, if any.
    @State private var selectedDayIndex: Int?
    @State private var showJourneyEdit = false
    @State private var showManageDays = false
    @State private var showEnrich = false
    @State private var showImport = false
    @State private var showSharing = false
    @State private var showExport = false
    @State private var showShowcase = false
    @State private var editingCamp: Camp?
    /// Delete-journey flow: tapping the menu entry routes to one of these depending on
    /// `JourneyStore.deleteBlocker` — a still-published journey explains itself and offers the
    /// Showcase sheet instead of the confirm dialog.
    @State private var showDeleteConfirm = false
    @State private var showDeleteBlockedAlert = false
    /// S1's story view — pushed via `navigationDestination` rather than a `NavigationLink` so the
    /// same state can also drive the shared-in auto-open below.
    @State private var showStory = false
    /// Guards the auto-open below to a single push per presentation — `.onAppear` fires again on
    /// returning from the story (this view becomes visible again), and without the guard that
    /// would push right back into it, trapping a shared-in viewer in a forward-only loop.
    @State private var hasAutoOpenedStory = false

    /// True when this journey lives in our own database (a shared-in journey is not ours to
    /// restructure or enrich). Fixtures / local-mode journeys are ours by definition.
    private var isOwner: Bool { store.isOwnedByCurrentUser(journeyID: journey.id) }

    /// D9: true for the bundled demo journey — drives the header badge and honest delete copy
    /// (it never touched iCloud, so the usual "deletes from your iCloud" wording would be false).
    private var isSample: Bool { store.isSampleJourney(journey.id) }

    /// The freshest copy of this journey from the store, so contextual edits reflect
    /// immediately after `store.reload()` (this view observes the store).
    private var live: Journey { store.journey(withID: journey.id) ?? journey }

    /// The flag glyph was a fixed 40 pt icon, not body text; scale it like one (same treatment
    /// as `JourneyGlobeCard.flagSize` in D1) so it stays in proportion with the title beside it.
    @ScaledMetric(relativeTo: .largeTitle) private var flagSize: CGFloat = 40

    var body: some View {
        let live = self.live
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header

                if live.isEmptyShell {
                    // Nothing to draw a map of and nothing to total up. Offer the ways in instead
                    // of rendering the content screens over an empty journey.
                    nextSteps
                } else {
                    // S1's clear entry point into the finished thing — placed above the map,
                    // not tucked into the overflow menu, because reading the story is meant to
                    // be the obvious next thing to do with a journey that has content.
                    readJourneyLink

                    RouteMapView(journey: journey, interactive: false)
                        .frame(height: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(Theme.hairline, lineWidth: 1)
                        )

                    statsSummary
                    if photoCount > 0 { photosLink }
                }

                if !live.description.isEmpty {
                    Text(live.description)
                        .font(.callout)
                        .foregroundStyle(Theme.textSecondary)
                }

                if !live.isEmptyShell { daySection }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(live.shortName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { showJourneyEdit = true } label: {
                        Label("Edit journey", systemImage: "square.and.pencil")
                    }
                    if isOwner {
                        Button { showManageDays = true } label: {
                            Label("Manage days", systemImage: "calendar.day.timeline.left")
                        }
                        Button { showEnrich = true } label: {
                            Label("Enrich journey", systemImage: "wand.and.stars")
                        }
                    }
                    Button { showImport = true } label: {
                        Label("Add photos", systemImage: "photo.badge.plus")
                    }
                    Button { showSharing = true } label: {
                        Label("Sharing", systemImage: "person.2")
                    }
                    Button { showShowcase = true } label: {
                        Label("Showcase", systemImage: "globe")
                    }
                    Button { showExport = true } label: {
                        Label("Export journey", systemImage: "square.and.arrow.up")
                    }
                    if isOwner {
                        Button(role: .destructive) { handleDeleteTap() } label: {
                            Label("Delete journey…", systemImage: "trash")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .tint(Theme.accent)
            }
        }
        .sheet(isPresented: daySheetPresented) {
            if let index = selectedDayIndex {
                DayDetailSheet(
                    journey: live,
                    dayIndex: index,
                    onSelectDay: { selectedDayIndex = $0 },
                    onClose: { selectedDayIndex = nil }
                )
                .environmentObject(store)
                .presentationDetents([.medium, .large])
                .presentationBackground(Theme.background)
            }
        }
        .sheet(isPresented: $showJourneyEdit) {
            JourneyEditSheet(journey: live).environmentObject(store)
        }
        .sheet(isPresented: $showManageDays) {
            ManageDaysSheet(journeyID: live.id).environmentObject(store)
        }
        .sheet(isPresented: $showEnrich) {
            EnrichJourneySheet(journey: live)
                .environmentObject(store)
                .environmentObject(entitlements)
                .environmentObject(intelligence)
        }
        .sheet(isPresented: $showImport) {
            PhotoImportSheet(journey: live).environmentObject(store).environmentObject(entitlements)
        }
        .sheet(item: $editingCamp) { camp in
            WaypointEditSheet(journeyID: live.id, camp: camp)
                .environmentObject(store)
                .environmentObject(entitlements)
                .environmentObject(intelligence)
        }
        .sheet(isPresented: $showExport) {
            JourneyExportSheet(journey: live).environmentObject(store).environmentObject(entitlements)
        }
        .sheet(isPresented: $showShowcase) {
            JourneyShowcaseSheet(journey: live).environmentObject(store).environmentObject(entitlements)
        }
        .sheet(isPresented: $showSharing) {
            JourneyShareView(journeyID: live.id,
                             journeyTitle: live.name,
                             service: PersistenceController.shared.sharingService)
        }
        .navigationDestination(isPresented: $showStory) {
            JourneyStoryView(journey: live).environmentObject(store)
        }
        .onAppear {
            // S1: "it should be what a shared-in viewer naturally lands on." A participant has no
            // reason to want the map-and-stats screen first — the story is the point of opening a
            // shared journey at all. Gated on `isEmptyShell` because an owner-only journey with
            // nothing in it yet has no story to auto-open, and `hasAutoOpenedStory` because this
            // fires again when returning from the pushed story (the view re-appears).
            guard !isOwner, !live.isEmptyShell, !hasAutoOpenedStory else { return }
            hasAutoOpenedStory = true
            showStory = true
        }
        .confirmationDialog("Delete this journey?",
                            isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete journey", role: .destructive) { deleteJourney() }
            Button("Cancel", role: .cancel) {}
        } message: {
            // Honest copy (the design verdict's own bar, D9): the sample never touched iCloud, so
            // the ordinary "from your iCloud and every family device" wording would be a lie here.
            if isSample {
                Text("This removes the sample \"\(live.shortName)\" journey from this device. It's bundled with the app, never synced — deleting it is permanent, but you can always start your own journey.")
            } else {
                Text("This deletes \"\(live.shortName)\" and its photos from your iCloud and every family device. Photos already saved in your Photos library are NOT affected. Consider using Export first to keep a copy.")
            }
        }
        .alert("Remove from Showcase first", isPresented: $showDeleteBlockedAlert) {
            Button("Open Showcase") { showShowcase = true }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("\"\(live.shortName)\" is on the public showcase. Remove it there before deleting the journey.")
        }
    }

    /// Route the destructive menu tap through `deleteBlocker` — a published journey must come off
    /// the showcase first (its mirror has no owner able to remove it once the source is gone).
    private func handleDeleteTap() {
        switch store.deleteBlocker(forJourneyID: live.id) {
        case .stillPublished:
            showDeleteBlockedAlert = true
        case .notOwner:
            break // menu entry is owner-gated; nothing to do if this is somehow reached.
        case nil:
            showDeleteConfirm = true
        }
    }

    private func deleteJourney() {
        guard store.deleteJourney(id: live.id) else { return }
        dismiss()
    }

    private var daySheetPresented: Binding<Bool> {
        Binding(get: { selectedDayIndex != nil },
                set: { if !$0 { selectedDayIndex = nil } })
    }

    private var photoCount: Int { store.photos(forJourneyID: journey.id).count }

    /// The ways into an empty journey. Owner-only: a shared-in journey is not ours to fill, so a
    /// participant gets the explanation without buttons that would fail.
    private var nextSteps: some View {
        JourneyNextStepsCard(
            title: "This journey is empty",
            message: isOwner
                ? "Add a route, days or photos and it comes to life on the globe."
                : "Nothing has been added to this journey yet. Its owner can add a route, days and photos.",
            steps: isOwner ? [
                .init(icon: "point.topleft.down.to.point.bottomright.curvepath",
                      title: "Add a route",
                      subtitle: "Import a GPX from Strava, Garmin or komoot — or draw it by hand") {
                          showJourneyEdit = true
                      },
                .init(icon: "calendar.badge.plus",
                      title: "Add days",
                      subtitle: "Build the day-by-day story, or seed days from your photo dates") {
                          showManageDays = true
                      },
                .init(icon: "photo.badge.plus",
                      title: "Add photos",
                      subtitle: "Photos carry their own dates and locations") {
                          showImport = true
                      },
            ] : [])
    }

    /// S1's clear entry point into `JourneyStoryView` — solid-fill rather than `photosLink`'s
    /// outline treatment, so it reads as the primary way to experience a finished journey rather
    /// than one link among several.
    private var readJourneyLink: some View {
        Button { showStory = true } label: {
            HStack(spacing: 10) {
                Image(systemName: "book.pages")
                    .font(.subheadline)
                Text("Read this journey")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.footnote.weight(.semibold))
            }
            .foregroundStyle(Theme.onAccent)
            .padding(14)
            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var photosLink: some View {
        NavigationLink {
            PhotosGridView(journeyID: journey.id)
                .environmentObject(store)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.subheadline)
                    .foregroundStyle(Theme.accent)
                Text("View all photos")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote)
                    .foregroundStyle(Theme.textTertiary)
            }
            .padding(14)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Theme.hairline, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(live.shortName)
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Text(live.countryFlag).font(.system(size: flagSize))
            }
            HStack(spacing: 8) {
                Text(live.country).foregroundStyle(Theme.textSecondary)
                if let dates = Formatters.dateRange(live.dateStarted, live.dateEnded) {
                    Text("·").foregroundStyle(Theme.textTertiary)
                    Text(dates).foregroundStyle(Theme.textSecondary)
                }
                if isSample {
                    Text("·").foregroundStyle(Theme.textTertiary)
                    SampleBadge()
                }
            }
            .font(.subheadline)
        }
    }

    /// Absent is shown as "—", never as 0. A journey created a minute ago has no route, and a
    /// hand-drawn one has no elevation; "0 km" and "0 m Summit" read as measurements that came back
    /// zero rather than numbers nobody has supplied yet.
    private var statsSummary: some View {
        let route = live.route
        let hasRoute = !route.coordinates.isEmpty
        return StatChipRow(items: [
            .init(icon: "figure.walk",
                  value: hasRoute ? Formatters.distanceKm(live.stats.totalDistance) : "—",
                  caption: "Distance"),
            .init(icon: "arrow.up.forward",
                  value: route.hasElevation ? Formatters.meters(live.stats.totalElevationGain) : "—",
                  caption: "Ascent"),
            .init(icon: "mountain.2",
                  value: live.stats.highestPoint.map { Formatters.meters($0.elevation) } ?? "—",
                  caption: "Summit"),
            .init(icon: "calendar",
                  value: live.stats.duration > 0 ? "\(live.stats.duration)" : "—",
                  caption: "Days"),
        ])
    }

    @ViewBuilder
    private var daySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Days")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            // A route without days (a bare GPX import, or a drawn route) used to leave this heading
            // standing over nothing.
            if live.camps.isEmpty {
                Button { showManageDays = true } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "calendar.badge.plus")
                            .font(.title3).foregroundStyle(Theme.accent).frame(width: 26)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(isOwner ? "No days yet" : "No days yet")
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                            Text(isOwner
                                 ? "Add them one by one, or let your photo dates propose them"
                                 : "The owner hasn't added days to this journey")
                                .font(.caption2).foregroundStyle(Theme.textTertiary)
                        }
                        Spacer(minLength: 8)
                        if isOwner {
                            Image(systemName: "chevron.right")
                                .font(.footnote).foregroundStyle(Theme.textTertiary)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Theme.hairline, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(!isOwner)
            }
            ForEach(Array(live.camps.enumerated()), id: \.element.id) { index, camp in
                Button {
                    selectedDayIndex = index
                } label: {
                    DayRow(camp: camp)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button { editingCamp = camp } label: {
                        Label("Edit day", systemImage: "square.and.pencil")
                    }
                }
            }
        }
    }
}

/// One day/camp row: day badge, name, elevation, per-day distance + gain, notes, highlights.
struct DayRow: View {
    let camp: Camp

    /// The day badge was sized to fit a fixed 46 pt square around a `.title3` digit; scale the
    /// square with that digit so a two-digit day number doesn't outgrow it at larger text sizes.
    @ScaledMetric(relativeTo: .title3) private var dayBadgeSize: CGFloat = 46

    var body: some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    dayBadge
                    VStack(alignment: .leading, spacing: 3) {
                        Text(camp.name)
                            .font(.headline)
                            .foregroundStyle(Theme.textPrimary)
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.up.to.line.compact")
                                .font(.caption2)
                                .foregroundStyle(Theme.accent)
                            Text(Formatters.meters(camp.elevation))
                                .font(.subheadline)
                                .foregroundStyle(Theme.textSecondary)
                            if let terrain = camp.terrain, !terrain.isEmpty {
                                Text("· \(terrain)")
                                    .font(.caption)
                                    .foregroundStyle(Theme.textTertiary)
                            }
                        }
                    }
                    Spacer()
                }

                HStack(spacing: 18) {
                    metric(icon: "point.topleft.down.to.point.bottomright.curvepath",
                           label: "Day distance", value: Formatters.distanceKm(camp.dayDistance))
                    metric(icon: "arrow.up.forward",
                           label: "Ascent", value: Formatters.meters(camp.elevationGainFromPrevious))
                    if camp.elevationLossFromPrevious > 0 {
                        metric(icon: "arrow.down.forward",
                               label: "Descent", value: Formatters.meters(camp.elevationLossFromPrevious))
                    }
                }

                if !camp.notes.isEmpty {
                    Text(camp.notes)
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }

                if !camp.highlights.isEmpty {
                    FlowChips(items: camp.highlights)
                }
            }
        }
    }

    private var dayBadge: some View {
        VStack(spacing: 0) {
            // Was 8 pt — below the `.caption2` floor; `.caption2` is the smallest this can go.
            Text("DAY").font(.caption2.weight(.bold)).foregroundStyle(Theme.textTertiary)
            Text("\(camp.dayNumber)").font(.title3.weight(.bold)).foregroundStyle(Theme.accent)
        }
        .frame(width: dayBadgeSize, height: dayBadgeSize)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func metric(icon: String, label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(value, systemImage: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            Text(label)
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
        }
    }
}

/// Simple wrapping chip row for highlights.
struct FlowChips: View {
    let items: [String]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(items.prefix(4), id: \.self) { item in
                Text(item)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Theme.accent)
                    .padding(.vertical, 4)
                    .padding(.horizontal, 9)
                    .background(Theme.accentSoft, in: Capsule())
            }
        }
    }
}

#Preview {
    NavigationStack {
        if let journey = try? FixtureLoader.load(named: "kilimanjaro") {
            JourneyDetailView(journey: journey)
        }
    }
    .environmentObject(JourneyStore(persistence: .preview))
    .environmentObject(EntitlementStore.previewFree)
    .environmentObject(Intelligence.previewUnavailable)
    .preferredColorScheme(.dark)
}
