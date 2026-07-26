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
    @EnvironmentObject private var entitlements: EntitlementStore
    @EnvironmentObject private var intelligence: Intelligence
    let journey: Journey
    let dayIndex: Int
    var onSelectDay: (Int) -> Void
    var onClose: () -> Void

    @State private var dayPhotos: [Photo] = []
    @State private var lightbox: LightboxData?
    @State private var showWaypointEdit = false
    @State private var showImport = false
    @State private var editingPhoto: Photo?

    /// The header chevrons were sized to fit a fixed 15 pt glyph in a fixed 40 pt circle; now
    /// that the glyph scales with Dynamic Type (`.subheadline`), the circle needs to scale too
    /// or the glyph outgrows it (same reasoning as D1's `DayNavigationView.chevronBoxSize`).
    @ScaledMetric(relativeTo: .subheadline) private var chevronBoxSize: CGFloat = 40

    private var camp: Camp? {
        journey.camps.indices.contains(dayIndex) ? journey.camps[dayIndex] : nil
    }

    /// True when this journey lives in our own database — gates the notes field's write
    /// affordance (S3), same rule `JourneyDetailView.isOwner` already applies to editing.
    private var isOwner: Bool { store.isOwnedByCurrentUser(journeyID: journey.id) }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            if let camp {
                VStack(alignment: .leading, spacing: 20) {
                    header(camp)
                    editBar(camp)

                    DayChapterSections(
                        camp: camp,
                        photos: dayPhotos,
                        isOwner: isOwner,
                        onNotesSave: { saveNotes($0, camp: camp) },
                        onPhotoTap: { index in
                            lightbox = LightboxData(
                                photos: dayPhotos, startIndex: index,
                                dayLabel: "Day \(camp.dayNumber)", dateLabel: dateLabel(camp)
                            )
                        },
                        onAddPhoto: { showImport = true },
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
                    .environmentObject(entitlements)
                    .environmentObject(intelligence)
            }
        }
        .sheet(isPresented: $showImport) {
            if let camp {
                PhotoImportSheet(journey: journey, presetWaypointID: camp.id, onComplete: loadPhotos)
                    .environmentObject(store)
                    .environmentObject(entitlements)
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
                chevron("chevron.left", label: "Previous day",
                        enabled: dayIndex > 0) { onSelectDay(dayIndex - 1) }

                VStack(spacing: 2) {
                    Text("DAY \(camp.dayNumber)")
                        .font(.caption2.weight(.bold))
                        .tracking(1)
                        .foregroundStyle(MapPalette.cyan)
                    Text(camp.name)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Theme.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity)
                // QUA-07: the day number is set in all-caps with letter tracking for looks; heard as
                // its own element it is "D-A-Y 3". One element, and the heading trait so the rotor can
                // jump straight back to it after reading a long day.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("Day \(camp.dayNumber), \(camp.name)"))
                .accessibilityAddTraits(.isHeader)

                chevron("chevron.right", label: "Next day",
                        enabled: dayIndex < journey.camps.count - 1) {
                    onSelectDay(dayIndex + 1)
                }
            }

            HStack(spacing: 10) {
                if let date = dateLabel(camp) {
                    Label(date, systemImage: "calendar")
                }
                Label(Formatters.meters(camp.elevation), systemImage: "mountain.2.fill")
            }
            .font(.caption)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            // The date and the elevation are the day's subtitle, one line on screen and one fact to
            // hear.
            .accessibilityElement(children: .combine)
        }
    }

    /// QUA-07: `label` is required. Both of these were bare `Image(systemName: "chevron.left")` inside
    /// a `Button`, which is announced as nothing useful — and they are the only way to move between
    /// days from this sheet, so a reader could open day 1 and not leave it.
    private func chevron(_ system: String, label: LocalizedStringKey, enabled: Bool,
                         action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(enabled ? Theme.textPrimary : Theme.textTertiary)
                .frame(width: chevronBoxSize, height: chevronBoxSize)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Theme.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    // MARK: - Helpers

    private func loadPhotos() {
        guard let camp else { dayPhotos = []; return }
        dayPhotos = store.photos(forDay: camp.dayNumber, journeyID: journey.id)
    }

    /// S3's write path: the same `JourneyStore.updateWaypoint` call `WaypointEditSheet` uses,
    /// touching only `description` (the notes) so an inline save never clobbers a field the user
    /// isn't looking at.
    private func saveNotes(_ text: String, camp: Camp) {
        store.updateWaypoint(id: camp.id, name: camp.name, description: text,
                             highlights: camp.highlights, elevation: camp.elevation,
                             dayNumber: camp.dayNumber)
    }

    private func dateLabel(_ camp: Camp) -> String? {
        Formatters.dayDate(dateStarted: journey.dateStarted, dayNumber: camp.dayNumber)
    }
}
