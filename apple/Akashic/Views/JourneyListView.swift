import SwiftUI

/// Scrollable list of journey cards.
struct JourneyListView: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @Environment(\.dismiss) private var dismiss
    @State private var showingNewJourney = false
    @State private var showingPaywall = false

    /// DIFF-15: an empty local store has two completely different meanings, and this list used to
    /// render only one of them. `syncStatus` is what tells them apart — whether a download is being
    /// held back, and whether we know by name what is waiting in it. Reached the same way
    /// `SettingsView` and `RootView` reach them, because both are process-wide singletons.
    @ObservedObject private var syncStatus = PersistenceController.shared.syncStatus
    @ObservedObject private var networkPolicy = NetworkPolicy.shared

    /// DIFF-16: whether the heavy first download is running RIGHT NOW. `SyncStatus.state` cannot
    /// answer this — `.active` is also the steady state of a fully synced app — so the engine
    /// publishes it separately, and only when it has evidence that content is actually coming.
    @ObservedObject private var downloadProgress = FirstSyncDownloadProgress.shared

    /// Start a create attempt: below the free limit → open the creation sheet; at the limit →
    /// present the paywall instead (never silently blocked). See `EntitlementStore`.
    private func startCreate() {
        if entitlements.canCreateJourney(ownedCount: store.billableOwnedJourneyCount) {
            showingNewJourney = true
        } else {
            showingPaywall = true
        }
    }

    /// The hero-versus-waiting-rows branch, decided by pure logic in `FirstSyncDownloadDecision` so
    /// it is unit-testable without a view. Only consulted while `store.journeys` is empty.
    private var emptyContent: FirstSyncDownloadDecision.EmptyListContent {
        FirstSyncDownloadDecision.emptyListContent(
            remoteSummaries: syncStatus.remoteJourneySummaries,
            isDownloadDeferred: syncStatus.state == .waitingForWiFi,
            isDownloadRunning: downloadProgress.isRunning)
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                if store.journeys.isEmpty {
                    switch emptyContent {
                    case .firstRunHero:
                        JourneyEmptyState { startCreate() }
                            .padding(.top, 60)
                    // The family archive exists and is waiting for Wi-Fi. Showing the "create your
                    // first journey" hero here is not merely quiet, it is false — so show what is
                    // actually there, and offer the one action that releases it.
                    case .awaitingDownload(let summaries):
                        JourneysAwaitingDownloadSection(summaries: summaries) {
                            networkPolicy.grantOneOccasionCellularDownload()
                        }
                    // DIFF-16: a download IS being held back and we could not find out what is in it.
                    // Neither the hero (false: this family has an archive) nor the rows (we have no
                    // names to put in them) — a neutral statement and a retry.
                    case .couldNotCheck:
                        JourneysCouldNotCheckSection(
                            // Re-runs the (kilobyte) summary pre-fetch. Passed in from here rather
                            // than defaulted inside the section: a default property value is
                            // evaluated in a NONISOLATED context (SE-0411's shape again), and both
                            // `PersistenceController` and `NetworkPolicy` are `@MainActor`.
                            onCheckAgain: {
                                PersistenceController.shared.syncCoordinator?
                                    .retryDeferredDownloadPreview()
                            },
                            onDownloadNow: { networkPolicy.grantOneOccasionCellularDownload() })
                    // DIFF-16, the owner's second point: the download is running and nothing has
                    // landed yet. Named rows stay visible when we have them, each with a progress
                    // affordance, so the surface does not blink to a blank at the moment it finally
                    // starts working.
                    case .downloading(let summaries):
                        JourneysDownloadingSection(summaries: summaries)
                    }
                } else {
                    ForEach(store.journeys) { journey in
                        NavigationLink(value: journey.id) {
                            JourneyCard(journey: journey, isSample: store.showsSampleBadge(journey.id))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Journeys")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    startCreate()
                } label: {
                    Image(systemName: "plus")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(Theme.accentText)
                }
                .accessibilityLabel("New journey")
                // QUA-10: the second-journey attempt that must hit the paywall on the free tier.
                .accessibilityIdentifier(A11yID.journeyListCreate)
            }
        }
        .sheet(isPresented: $showingNewJourney) {
            // On create, close the list so the globe (which observes `pendingJourneySelection`)
            // flies straight into the new journey.
            NewJourneySheet(onCreated: { _ in dismiss() })
                .environmentObject(store)
                .environmentObject(entitlements)
        }
        .sheet(isPresented: $showingPaywall) {
            PaywallView(reason: .journeyLimit)
                .environmentObject(entitlements)
        }
        .navigationDestination(for: String.self) { id in
            if let journey = store.journey(withID: id) {
                JourneyDetailView(journey: journey)
            }
        }
    }
}

/// First-run hero shown when there are no journeys yet — the front door for a new family.
struct JourneyEmptyState: View {
    var onCreate: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .fill(Theme.accentSoft)
                    .frame(width: 96, height: 96)
                Image(systemName: "mountain.2.fill")
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(Theme.accentText)
            }
            .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("Start your first journey")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("Name a trek, drop in a GPX route, and let your photos fill the days.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: onCreate) {
                Label("Create a journey", systemImage: "plus")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
                    .padding(.vertical, 14)
                    .padding(.horizontal, 24)
                    .background(Theme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
    }
}

/// A single journey summary card.
struct JourneyCard: View {
    let journey: Journey
    /// D9: true for the bundled demo journey. The badge is the "tell it apart" half of the
    /// requirement; the "delete is obvious and easy" half needs no bespoke UI — it already shares
    /// the ordinary destructive delete in `JourneyDetailView`'s overflow menu.
    var isSample: Bool = false

    /// The flag glyph sits in a fixed 120 pt hero band; scale it (same treatment as
    /// `JourneyGlobeCard.flagSize` in D1) so it stays proportionate instead of eventually
    /// overflowing that fixed-height strip.
    @ScaledMetric(relativeTo: .largeTitle) private var flagSize: CGFloat = 34

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Hero band (gradient placeholder + flag; real hero images arrive with sync).
            ZStack(alignment: .bottomLeading) {
                Theme.heroGradient
                    .frame(height: 120)
                    .overlay(alignment: .topTrailing) {
                        Text(journey.countryFlag)
                            .font(.system(size: flagSize))
                            .padding(12)
                            // The country is named in words two lines below; the flag emoji is the
                            // same fact as a picture, and VoiceOver reads it as its own element.
                            .accessibilityHidden(true)
                    }
                    .overlay(alignment: .topLeading) {
                        if isSample { SampleBadge().padding(12) }
                    }
                VStack(alignment: .leading, spacing: 2) {
                    Text(journey.shortName)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(journey.country)
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(14)
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

            if let dates = Formatters.dateRange(journey.dateStarted, journey.dateEnded) {
                Label(dates, systemImage: "calendar")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }

            HStack(spacing: 10) {
                StatChip(icon: "figure.walk", value: Formatters.distanceKm(journey.stats.totalDistance), caption: "Distance")
                    .accessibilityElement(children: .combine)
                StatChip(icon: "arrow.up.forward", value: Formatters.meters(journey.stats.totalElevationGain), caption: "Ascent")
                    .accessibilityElement(children: .combine)
                StatChip(icon: "calendar", value: "\(journey.stats.duration)", caption: "Days")
                    .accessibilityElement(children: .combine)
            }

            if let summit = journey.stats.highestPoint {
                Label("\(summit.name) · \(Formatters.meters(summit.elevation))", systemImage: "flag.checkered")
                    .font(.footnote)
                    .foregroundStyle(Theme.textTertiary)
                    .accessibilityLabel(Text("Summit \(summit.name), \(Formatters.meters(summit.elevation))"))
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
        // QUA-07: one card is one journey. Left uncombined it was up to twelve elements — a flag, a
        // badge, a name, a country, a date range, six chip fragments and a summit — which is a lot of
        // swiping to decide whether this is the trip you wanted to open. `children: .combine` rather
        // than a hand-written label so a card gains nothing to forget when a field is added; the
        // decoration above is hidden so the combination is the parts that mean something.
        .accessibilityElement(children: .combine)
    }
}

/// D9: small "SAMPLE" pill marking the bundled demo journey wherever it surfaces (this list's
/// card, the globe's journey strip, the detail header) — the one component so the three call
/// sites can't drift in wording or styling. Uses `Theme.accent`/`Theme.onAccent`, the same pair
/// already doing CTA duty elsewhere (e.g. `JourneyEmptyState`'s "Start your first journey"), so
/// this doesn't introduce a new colour to the palette.
struct SampleBadge: View {
    var body: some View {
        Text("SAMPLE")
            .font(.caption2.weight(.bold))
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Theme.accent, in: Capsule())
            // QUA-07: all-caps is a visual weight, not a word — VoiceOver spells short uppercase
            // runs out letter by letter, and "E-K-S-E-M-P-E-L" is not what this badge means. The
            // label restores the sentence and says what the badge is telling you.
            .accessibilityLabel("Sample journey")
    }
}

#Preview {
    NavigationStack { JourneyListView() }
        .environmentObject(JourneyStore(persistence: .preview))
        .environmentObject(EntitlementStore.previewFree)
        .preferredColorScheme(.dark)
}

// MARK: - Waiting to download (DIFF-15)

/// What a family member sees when they install on cellular: the journeys that are already in iCloud,
/// named, with an honest size, and one action that starts the download anyway.
///
/// The problem this replaces was not silence. `NetworkPolicy` correctly defers the first fetch on a
/// metered path and `SyncStatus` correctly says so — in Settings, one screen away. The journey list
/// meanwhile read an empty store as "new customer" and invited them to *create* their first journey
/// while the family's three were sitting there waiting, which is the one wrong thing it could say.
struct JourneysAwaitingDownloadSection: View {
    let summaries: [RemoteJourneySummary]
    /// Releases the deferred download for THIS occasion only — a one-time pass, never a change to
    /// the "Download over Wi-Fi only" preference. See `NetworkPolicy.grantOneOccasionCellularDownload`.
    var onDownloadNow: () -> Void

    private var totalPhotos: Int { summaries.reduce(0) { $0 + $1.photoCount } }

    /// Sized from what the first sync ACTUALLY fetches — metadata and thumbnails, not originals.
    /// See `SyncSizeEstimate.averagePhotoBytes` for the measurement behind the number.
    private var estimate: String { SyncSizeEstimate.humanReadable(photoCount: totalPhotos) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Your journeys are in iCloud")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("About \(estimate) of journey details and preview photos downloads when you're on Wi-Fi. Full-quality photos load when you open them.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 2)

            ForEach(summaries) { summary in
                JourneyAwaitingDownloadCard(summary: summary)
            }

            Button(action: onDownloadNow) {
                // Same wording as the Settings row that does the same thing, deliberately sharing
                // the catalogue key: two different sentences for one action is how a translation
                // starts disagreeing with itself.
                Label("Download now over cellular", systemImage: "arrow.down.circle")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(maxWidth: .infinity)
                    // 14 + 14 + the label's own line height clears the 44 pt minimum target with
                    // room for larger Dynamic Type sizes (the enforced audit checks this).
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(A11yID.journeyListDownloadNow)
        }
        .padding(.top, 8)
    }
}

/// One journey that exists in iCloud but not yet on this device: everything a real `JourneyCard`
/// shows minus the parts that need bytes, plus an explicit statement that it has not arrived.
///
/// Visibly un-downloaded rather than a shimmering placeholder: the hero band is a flat fill with a
/// download glyph instead of `Theme.heroGradient`, and the row is not tappable, because there is
/// nothing behind it to open yet. A row that looked ready and then did nothing would be the same
/// class of lie in a smaller font.
struct JourneyAwaitingDownloadCard: View {
    let summary: RemoteJourneySummary
    /// DIFF-16: the same row while the download is actually running. Only the footer changes — the
    /// row must not jump or re-layout at the moment the download starts, because a surface that
    /// rebuilds itself is how "it's working" comes across as "something broke".
    var isDownloading: Bool = false

    @ScaledMetric(relativeTo: .largeTitle) private var glyphSize: CGFloat = 30

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ZStack(alignment: .bottomLeading) {
                Theme.fillSubtle
                    .frame(height: 96)
                    .overlay(alignment: .topTrailing) {
                        Image(systemName: "icloud.and.arrow.down")
                            .font(.system(size: glyphSize))
                            .foregroundStyle(Theme.textTertiary)
                            .padding(12)
                            // The row says "waiting for Wi-Fi" in words two lines below; the glyph
                            // is the same fact as a picture (same treatment as `JourneyCard`'s flag).
                            .accessibilityHidden(true)
                    }
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary.name)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Theme.textPrimary)
                    if !summary.country.isEmpty {
                        Text(summary.country)
                            .font(.subheadline)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .padding(14)
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

            if let dates = Formatters.dateRange(summary.dateStarted, summary.dateEnded) {
                Label(dates, systemImage: "calendar")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }

            HStack(spacing: 8) {
                // Reuses the catalogue's plural-varied "%lld photos" — Norwegian pluralises
                // "bilde → bilder", which appending an "s" cannot express.
                Text("\(summary.photoCount) photos")
                Text(verbatim: "·")
                if isDownloading {
                    ProgressView()
                        .controlSize(.mini)
                        // The word next to it says the same thing; a spinner with no label is
                        // exactly what `.sufficientElementDescription` is right to flag.
                        .accessibilityHidden(true)
                    Text("Downloading…")
                } else {
                    Text("Waiting for Wi-Fi to download")
                }
            }
            .font(.footnote)
            .foregroundStyle(Theme.textTertiary)
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
        // One card is one journey, exactly as `JourneyCard` decided (QUA-07): combined, the row reads
        // as "Kilimanjaro, Tanzania, 29 Sep – 9 Oct 2023, 412 photos, waiting for Wi-Fi to download"
        // rather than as six fragments to swipe through, and the "·" is `verbatim` so it is never a
        // catalogue string of its own.
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Could not check (DIFF-16)

/// What the list says when a download IS being held back and the pre-fetch could not find out what
/// is in it.
///
/// ## Why this is not the first-run hero
///
/// MEASURED BY THE OWNER on TestFlight build 101 — fresh install, cellular, the exact scenario
/// DIFF-15 was built for: the sized first-sync prompt appeared, so the remote photo COUNT query
/// reached Production and answered, and the journey rows did not render. Under DIFF-15's branch a
/// `nil` summary fell through to "Start your first journey", so the one screen a family sees on a new
/// device invited them to create their first journey while their archive sat in iCloud. That is not a
/// quiet failure, it is a confident wrong answer, and it is why `nil` and `[]` are now different
/// states rather than the same fallback.
///
/// The copy claims nothing it cannot prove. It does not say journeys are waiting — the query that
/// would have established that is precisely what failed — only that the check did not go through, and
/// it offers the two things that can move the situation forward: check again, or stop waiting for Wi-Fi.
struct JourneysCouldNotCheckSection: View {
    /// Re-run the (kilobyte) summary pre-fetch.
    var onCheckAgain: () -> Void
    /// Releases the deferred download for THIS occasion only — a one-time pass, never a change to
    /// the "Download over Wi-Fi only" preference. The honest PRIMARY action here: it downloads the
    /// real journeys and does not depend on the query that just failed.
    var onDownloadNow: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Couldn't check iCloud")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("Your journeys download when you're on Wi-Fi. We couldn't reach iCloud just now to see what's waiting — nothing has been lost, and nothing has been changed.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 2)

            Button(action: onDownloadNow) {
                // Same wording, and deliberately the same catalogue key, as the waiting-rows surface
                // and the Settings row: one action, one sentence, in every language.
                Label("Download now over cellular", systemImage: "arrow.down.circle")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
            // Shared with `JourneysAwaitingDownloadSection`: one identifier for "the control that
            // releases this download", and the two surfaces are mutually exclusive by construction
            // (they are two arms of one `switch`), so it can never be ambiguous on screen.
            .accessibilityIdentifier(A11yID.journeyListDownloadNow)

            Button(action: onCheckAgain) {
                Label("Check again", systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.accentText)
                    .frame(maxWidth: .infinity)
                    // 44 pt plus a `contentShape`: a text-only button is exactly the shape that
                    // produced six of the seven `.hitRegion` findings in QUA-29, and growing the
                    // frame without the shape leaves the extra area untappable while the audit passes.
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 8)
    }
}

// MARK: - Downloading (DIFF-16)

/// The state between "the download was released" and "there are journeys on screen".
///
/// THE OWNER'S SECOND POINT, and it stands entirely on its own: sync happens invisibly in the
/// background, so even the path that WORKS presents as an empty screen that fills in at some
/// unannounced later moment — which reads as broken. There is no per-record progress here on purpose:
/// `CKSyncEngine` does not report one, inventing a percentage would be a number nothing could stand
/// behind, and what the user actually needs is the difference between "nothing is happening" and
/// "this is happening now".
///
/// When names are known the rows stay, each with its own progress footer, so the surface does not
/// blink to a blank at the moment it starts succeeding. When they are not — the build-101 case, where
/// the count answered and the journey query did not — the header alone is still strictly more than the
/// void it replaces.
struct JourneysDownloadingSection: View {
    let summaries: [RemoteJourneySummary]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.small)
                        // Decorative: the heading beside it is the same fact in words, and a spinner
                        // with no label is what `.sufficientElementDescription` is right to flag.
                        .accessibilityHidden(true)
                    Text("Downloading your journeys")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Theme.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                }
                Text("This can take a few minutes on a slow connection. Journeys appear as they arrive.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 2)

            ForEach(summaries) { summary in
                JourneyAwaitingDownloadCard(summary: summary, isDownloading: true)
            }
        }
        .padding(.top, 8)
    }
}
