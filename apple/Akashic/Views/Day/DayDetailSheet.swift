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

    /// DIFF-13 — the curation proposal for this day, and whether it is being computed.
    ///
    /// Nil means "not asked yet"; a non-nil result with nothing in it means "asked, nothing worth
    /// proposing" — and the row shows nothing in that case rather than an empty suggestion, which
    /// would read as the feature being broken.
    @State private var curation: CurationResult?
    @State private var isCurating = false
    /// Set once the user accepts or dismisses, so a re-open does not re-propose what they answered.
    @State private var curationAnswered = false

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
                                dayLabel: String(localized: "Day \(camp.dayNumber)",
                                                 comment: "Photo lightbox: badge naming the day a photo belongs to."),
                                dateLabel: dateLabel(camp)
                            )
                        },
                        onAddPhoto: { showImport = true },
                        onEditPhoto: { editingPhoto = $0 }
                    )

                    if isOwner, !curationAnswered {
                        curationRow(camp)
                    }

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

    // MARK: - Curation (DIFF-13)

    /// The accept-or-dismiss row for this day's photo curation.
    ///
    /// This is the surface that makes the whole Vision chain reachable. Until it existed nothing
    /// called `JourneyStore.curationProposal`, so the optimiser stripped the entire feature and
    /// `otool` showed Vision was not even linked into the binary — the engine was written, tested,
    /// and absent from the app. That is why DIFF-13's verification is `otool | grep -i vision`
    /// rather than a screenshot.
    ///
    /// Owner-only and one-shot per open: a suggestion the user has answered must not come back, which
    /// is the same discipline `SuggestionModel` enforces for the creation flow.
    @ViewBuilder
    private func curationRow(_ camp: Camp) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let curation, !curation.isEmpty {
                let picks = curation.bestOfByDay[camp.dayNumber] ?? []
                Text("Suggested for this day")
                    .font(.caption.weight(.semibold))
                    .tracking(0.8)
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.textSecondary)

                if !picks.isEmpty {
                    Text("\(picks.count) photos stand out. Accepting puts them first.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.textPrimary)
                }
                if curation.redundantCount > 0 {
                    // Reported, never actioned — a near-duplicate is a distance heuristic, and a
                    // false positive would cost someone a photograph.
                    Text("\(curation.redundantCount) look like near-duplicates.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }

                HStack(spacing: 12) {
                    Button {
                        acceptCuration(camp)
                    } label: {
                        Label("Use these", systemImage: "checkmark")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(picks.isEmpty)

                    Button {
                        curationAnswered = true
                    } label: {
                        Text("Not now")
                    }
                    .foregroundStyle(Theme.textSecondary)
                }
            } else if isCurating {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Looking at this day's photos…")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
            } else if curation == nil, dayPhotos.count > 1 {
                // Explicitly user-initiated. Scoring every day's photographs on open would spend
                // battery on days nobody asked about, and Vision on a large day is not free.
                Button {
                    Task { await runCuration() }
                } label: {
                    Label("Suggest the best photos", systemImage: "sparkles")
                        .font(.subheadline)
                }
                .foregroundStyle(Theme.accent)
                .accessibilityHint(Text("Looks at this day's photographs on your device and suggests which stand out."))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func runCuration() async {
        isCurating = true
        defer { isCurating = false }
        // Whole-journey proposal, then this day's slice is read from it — the hero is a
        // journey-level decision and cannot be judged from one day in isolation.
        curation = await store.curationProposal(forJourneyID: journey.id)
    }

    private func acceptCuration(_ camp: Camp) {
        guard let curation else { return }
        // One batched save rather than one per photograph, so the gallery settles once instead of
        // visibly reshuffling six times.
        store.acceptCuratedBestOf(curation, day: camp.dayNumber, journeyID: journey.id)
        store.acceptCuratedHero(curation)
        curationAnswered = true
        loadPhotos()
    }

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
