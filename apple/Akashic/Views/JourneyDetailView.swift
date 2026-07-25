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

    /// True when this journey lives in our own database (a shared-in journey is not ours to
    /// restructure or enrich). Fixtures / local-mode journeys are ours by definition.
    private var isOwner: Bool { store.isOwnedByCurrentUser(journeyID: journey.id) }

    /// The freshest copy of this journey from the store, so contextual edits reflect
    /// immediately after `store.reload()` (this view observes the store).
    private var live: Journey { store.journey(withID: journey.id) ?? journey }

    var body: some View {
        let live = self.live
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header

                RouteMapView(journey: journey, interactive: false)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(Theme.hairline, lineWidth: 1)
                    )

                statsSummary
                photosLink

                if !live.description.isEmpty {
                    Text(live.description)
                        .font(.callout)
                        .foregroundStyle(Theme.textSecondary)
                }

                daySection
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
                .preferredColorScheme(.dark)
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
        .confirmationDialog("Delete this journey?",
                            isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete journey", role: .destructive) { deleteJourney() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This deletes \"\(live.shortName)\" and its photos from your iCloud and every family device. Photos already saved in your Photos library are NOT affected. Consider using Export first to keep a copy.")
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
                Text(live.countryFlag).font(.system(size: 40))
            }
            HStack(spacing: 8) {
                Text(live.country).foregroundStyle(Theme.textSecondary)
                if let dates = Formatters.dateRange(live.dateStarted, live.dateEnded) {
                    Text("·").foregroundStyle(Theme.textTertiary)
                    Text(dates).foregroundStyle(Theme.textSecondary)
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

    private var daySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Days")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
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
            Text("DAY").font(.system(size: 8, weight: .bold)).foregroundStyle(Theme.textTertiary)
            Text("\(camp.dayNumber)").font(.title3.weight(.bold)).foregroundStyle(Theme.accent)
        }
        .frame(width: 46, height: 46)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func metric(icon: String, label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(value, systemImage: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            Text(label)
                .font(.system(size: 10))
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
