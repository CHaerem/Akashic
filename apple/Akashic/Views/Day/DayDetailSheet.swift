import SwiftUI

/// The trek-mode day sheet — feature parity with the web `DayChapter` + `BottomSheet`.
///
/// Shows the selected day's header, day stats, notes, highlights, weather, fun-fact
/// carousel, discoveries (POIs + historical sites) and a tappable photo strip. Every
/// section hides itself when its data is absent. Day navigation is delegated to
/// `onSelectDay` so it works both from the globe (drives the map camera) and from a plain
/// list (`JourneyDetailView`).
struct DayDetailSheet: View {
    @EnvironmentObject private var store: JourneyStore
    let journey: Journey
    let dayIndex: Int
    var onSelectDay: (Int) -> Void
    var onClose: () -> Void

    @State private var dayPhotos: [Photo] = []
    @State private var lightbox: LightboxData?
    @State private var showWaypointEdit = false
    @State private var showImport = false
    @State private var editingPhoto: Photo?

    private var camp: Camp? {
        journey.camps.indices.contains(dayIndex) ? journey.camps[dayIndex] : nil
    }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            if let camp {
                VStack(alignment: .leading, spacing: 20) {
                    header(camp)
                    editBar(camp)
                    dayStats(camp)

                    if !camp.notes.isEmpty {
                        Text(camp.notes)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if !camp.highlights.isEmpty {
                        highlights(camp.highlights)
                    }

                    if let weather = camp.weather {
                        WeatherRow(weather: weather)
                    }

                    if let facts = camp.funFacts, !facts.isEmpty {
                        FunFactsCarousel(facts: facts)
                    }

                    DayDiscoveriesView(
                        pointsOfInterest: camp.pointsOfInterest ?? [],
                        historicalSites: camp.historicalSites ?? []
                    )

                    DayPhotoStrip(
                        photos: dayPhotos,
                        onTap: { index in
                            lightbox = LightboxData(
                                photos: dayPhotos, startIndex: index,
                                dayLabel: "Day \(camp.dayNumber)", dateLabel: dateLabel(camp)
                            )
                        },
                        onAdd: { showImport = true },
                        onEditPhoto: { editingPhoto = $0 }
                    )

                    // Day comments (web parity: DayCommentsSection). Self-contained view.
                    DayCommentsSection(camp: camp, journeyId: journey.id)
                        .id(Self.commentsAnchorID)
                }
                .padding(20)
                .padding(.bottom, 40)
            }
        }
        .background(Theme.background)
        .presentationDragIndicator(.visible)
        .onAppear(perform: loadPhotos)
        .onChange(of: dayIndex) { _, _ in loadPhotos() }
        .fullScreenCover(item: $lightbox) { data in
            PhotoLightboxView(data: data, journey: journey).environmentObject(store)
        }
        .sheet(isPresented: $showWaypointEdit) {
            if let camp {
                WaypointEditSheet(journeyID: journey.id, camp: camp, onSave: loadPhotos)
                    .environmentObject(store)
            }
        }
        .sheet(isPresented: $showImport) {
            if let camp {
                PhotoImportSheet(journey: journey, presetWaypointID: camp.id, onComplete: loadPhotos)
                    .environmentObject(store)
            }
        }
        .sheet(item: $editingPhoto) { photo in
            PhotoEditSheet(photo: photo, journey: journey) { _ in loadPhotos() }
                .environmentObject(store)
        }
        // Screenshot seam: auto-scroll to the comments section on launch (env-gated).
        .onAppear { scrollToCommentsIfRequested(proxy) }
        }
    }

    // MARK: - Screenshot seam

    private static let commentsAnchorID = "day-comments-section"

    /// Auto-scroll the sheet to the comments section shortly after launch, only when
    /// `AKASHIC_SCROLL_COMMENTS` is set (used to capture `Docs/screenshot-comments.png`).
    /// A no-op for normal launches.
    private func scrollToCommentsIfRequested(_ proxy: ScrollViewProxy) {
        guard ProcessInfo.processInfo.environment["AKASHIC_SCROLL_COMMENTS"] != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            withAnimation(.easeInOut(duration: 0.4)) {
                proxy.scrollTo(Self.commentsAnchorID, anchor: .bottom)
            }
        }
    }

    /// A compact edit affordance for the day: opens the waypoint editor. Contextual (no global
    /// edit mode) — the button is always available on the day sheet.
    @ViewBuilder
    private func editBar(_ camp: Camp) -> some View {
        HStack {
            Spacer()
            Button { showWaypointEdit = true } label: {
                Label("Edit day", systemImage: "slider.horizontal.3")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .padding(.vertical, 6).padding(.horizontal, 12)
                    .background(Theme.accentSoft, in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Header

    private func header(_ camp: Camp) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                chevron("chevron.left", enabled: dayIndex > 0) { onSelectDay(dayIndex - 1) }

                VStack(spacing: 2) {
                    Text("DAY \(camp.dayNumber)")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(1)
                        .foregroundStyle(MapPalette.cyan)
                    Text(camp.name)
                        .font(.system(size: 19, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity)

                chevron("chevron.right", enabled: dayIndex < journey.camps.count - 1) {
                    onSelectDay(dayIndex + 1)
                }
            }

            HStack(spacing: 10) {
                if let date = dateLabel(camp) {
                    Label(date, systemImage: "calendar")
                }
                Label(Formatters.meters(camp.elevation), systemImage: "mountain.2.fill")
            }
            .font(.system(size: 12))
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
        }
    }

    private func chevron(_ system: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(enabled ? Theme.textPrimary : Theme.textTertiary)
                .frame(width: 40, height: 40)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Theme.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // MARK: - Day stats

    private func dayStats(_ camp: Camp) -> some View {
        HStack(spacing: 10) {
            StatChip(icon: "figure.walk", value: Formatters.distanceKm(camp.dayDistance), caption: "Distance")
            StatChip(icon: "arrow.up.forward", value: Formatters.meters(camp.elevationGainFromPrevious), caption: "Ascent")
            if camp.elevationLossFromPrevious > 0 {
                StatChip(icon: "arrow.down.forward", value: Formatters.meters(camp.elevationLossFromPrevious), caption: "Descent")
            }
            StatChip(icon: "mountain.2", value: Formatters.meters(camp.elevation), caption: "Elevation")
        }
    }

    // MARK: - Highlights

    private func highlights(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(icon: "✨", title: "Highlights")
            VStack(alignment: .leading, spacing: 6) {
                ForEach(items, id: \.self) { item in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(Theme.accent).frame(width: 5, height: 5).padding(.top, 6)
                        Text(item)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private func loadPhotos() {
        guard let camp else { dayPhotos = []; return }
        dayPhotos = store.photos(forDay: camp.dayNumber, journeyID: journey.id)
    }

    private func dateLabel(_ camp: Camp) -> String? {
        guard let start = DateOnly.date(from: journey.dateStarted) else { return nil }
        guard let date = Calendar.dayCalendar.date(byAdding: .day, value: camp.dayNumber - 1, to: start)
        else { return nil }
        return DayDetailSheet.dayFormatter.string(from: date)
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMM d, yyyy"
        return f
    }()
}

private extension Calendar {
    /// UTC calendar so per-day date arithmetic matches the `DateOnly` (UTC) day boundaries.
    static let dayCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
}
