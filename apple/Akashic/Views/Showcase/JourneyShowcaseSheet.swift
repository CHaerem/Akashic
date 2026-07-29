import SwiftUI
import CloudKit

/// "Showcase" sheet (T3.3): publish / update / remove a journey's public mirror (MAPPING §8).
///
/// Structure and Theme usage follow `JourneyExportSheet`. It is only *functional* in CloudKit
/// mode (and an entitled build) — everywhere else it shows an explanatory footer instead of the
/// buttons, exactly like the CloudKit-import section gates itself in `SettingsView`.
struct JourneyShowcaseSheet: View {
    let journey: Journey

    @EnvironmentObject private var store: JourneyStore
    @Environment(\.dismiss) private var dismiss

    @StateObject private var model = ShowcaseViewModel()
    @ObservedObject private var networkPolicy = NetworkPolicy.shared
    /// Explicit acknowledgement required before a *private* journey can be published
    /// world-readable (the consequence is spelled out in the warning above the toggle).
    @State private var acknowledgeWorldReadable = false
    /// Set when the user taps Publish on an expensive path with Wi-Fi-only on — publishing tens of
    /// MB over cellular warns (never blocks): the mirror is small enough to be a choice, not a bill.
    @State private var showCellularPublishConfirm = false
    /// QUA-65: unpublishing kills a shared link for everyone holding it — confirm first.
    @State private var showingRemoveConfirm = false

    /// The freshest copy of this journey (its `isPublic` may flip during a publish).
    private var live: Journey { store.journey(withID: journey.id) ?? journey }

    /// The mirror is only writable from the CloudKit-entitled build running in CloudKit mode.
    private var functional: Bool { model.realRunAvailable && store.mode == .cloudKit }

    var body: some View {
        NavigationStack {
            List {
                statusSection
                if functional {
                    actionSection
                } else {
                    unavailableSection
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Showcase")
            .navigationBarTitleDisplayMode(.inline)
            // Block interactive swipe-dismiss while a publish/remove is in flight, matching the
            // disabled Done button — otherwise a swipe leaves the CloudKit op running detached and
            // its failure (or partial-failure) reports to nobody. (finding #8.)
            .interactiveDismissDisabled(model.isWorking)
            // Verify before the status row is read, not after (QUA-45). Only when there is a claim to
            // check and someone who can check it: a still-private journey asserts nothing about the
            // web, a non-CloudKit build cannot ask, and for a journey shared INTO this account the
            // creator comparison would compare against the wrong identity and answer "absent" for a
            // mirror that is really there. All three rest at `.notChecked`, whose copy says only
            // "marked as published on this device".
            .task {
                guard functional, isOwner, live.isPublic else { return }
                model.verifyPresence(slug: live.slug)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.tint(Theme.accentText)
                        .disabled(model.isWorking)
                }
            }
            .confirmationDialog("Publish over cellular?",
                                isPresented: $showCellularPublishConfirm,
                                titleVisibility: .visible) {
                Button("Publish anyway") { performPublish() }
                Button("Wait for Wi-Fi", role: .cancel) {}
            } message: {
                Text("About \(ByteCount.string(estimatedPublishBytes)) of thumbnails and metadata will upload over cellular. Full-resolution photos are never uploaded.")
            }
        }
    }

    /// Order-of-magnitude estimate of a publish's upload payload: one thumbnail (~60 KB) per photo
    /// plus the route/waypoints/hero metadata. Deliberately cheap — no per-file disk reads — so the
    /// confirm dialog opens instantly even for a 900-photo journey.
    private var estimatedPublishBytes: Int64 {
        let photos = store.photos(forJourneyID: live.id)
        return Int64(photos.count) * 60_000 + 300_000
    }

    /// Only the journey's owner may manage its public showcase. A journey shared *into* this
    /// account is the owner's to publish/unpublish. (finding #6.)
    private var isOwner: Bool { store.isOwnedByCurrentUser(journeyID: journey.id) }

    // MARK: - Status

    private var statusSection: some View {
        Section {
            HStack {
                Label(statusTitle, systemImage: statusIcon)
                    .foregroundStyle(statusTint)
                Spacer()
                Text(live.shortName).foregroundStyle(Theme.textSecondary)
            }
            // QUA-65: the link is the point of publishing, and it used to render ONLY in the
            // seconds after a publish run (`resultView`) — an owner who published yesterday saw
            // Public / Update / Remove and no link anywhere, and the only in-app recovery was
            // re-running a publish. SHIP-17 counts "showcase link sent" as a beta criterion;
            // this row is what makes "published once" mean "shareable forever". The VERIFIED
            // slug is the only correct source (cross-owner collision: the pretty slug can lose),
            // so the row appears exactly when the mirror check confirmed presence.
            if case .onShowcase(let slug) = model.verification,
               let url = AppInfo.showcaseURL(slug: slug) {
                ShareLink(item: url) {
                    Label("Share showcase link", systemImage: "square.and.arrow.up")
                }
                .foregroundStyle(Theme.accent)
                Text(url.absoluteString)
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .textSelection(.enabled)
            }
        } header: {
            Text("Public showcase")
        } footer: {
            Text(statusFooter)
        }
    }

    // MARK: The status row is a claim about the WEB, not about a local flag (QUA-45)
    //
    // This row used to be `live.isPublic ? "Public" : "Private"` with a footer that stated, as fact,
    // that the journey "is published to the world-readable showcase". Measured 2026-07-27 on the
    // sample Kilimanjaro: it said exactly that while a REST query against the production public
    // database returned zero PublicJourney records. `isPublic` is a local, environment-blind flag
    // (see `PublicMirrorPresence`), so it can only ever support "marked as published here" — the
    // stronger claim needs `model.verification` to have actually asked the mirror.
    //
    // Why this matters beyond the wrong sentence: SHIP-17 counts "showcase link sent" as a beta
    // criterion. A household that believes it shared and did not is a false negative on exactly that
    // number, and it has no reason to press "Update showcase" because the app already told it the job
    // was done. The household cannot see the difference; only the mirror can.

    private var statusTitle: LocalizedStringKey {
        guard live.isPublic else { return "Private" }
        if case .notOnShowcase = model.verification { return "Not on the showcase" }
        return "Public"
    }

    private var statusIcon: String {
        guard live.isPublic else { return "lock" }
        if case .notOnShowcase = model.verification { return "globe.badge.chevron.backward" }
        return "globe"
    }

    private var statusTint: Color {
        guard live.isPublic else { return Theme.textSecondary }
        if case .notOnShowcase = model.verification { return Theme.warning }
        return Theme.accent
    }

    /// The footer says only what is known. Four states, and only one of them asserts anything about
    /// the web — the three "we have not asked / could not ask / asked and it is gone" cases are
    /// deliberately not collapsed into the confident sentence.
    private var statusFooter: LocalizedStringKey {
        guard live.isPublic else {
            return "This journey is private. Publishing copies its route, day notes and photo thumbnails to a world-readable showcase that anyone can view without signing in. Full-resolution photos stay on your devices."
        }
        switch model.verification {
        case .onShowcase:
            return "This journey is published to the world-readable showcase. Its route, day notes and photo thumbnails can be viewed on the web without signing in. Full-resolution photos are never uploaded."
        case .notOnShowcase:
            return "This journey is marked as published on this device, but nothing for it was found on the live showcase — so it is not on the web right now, and its link would not open. Publish it again to put it back."
        case .checking:
            return "This journey is marked as published on this device. Checking the live showcase…"
        // `couldNotCheck` and `notChecked` make the same weaker claim on purpose: a check that failed
        // and a check that never ran (this build cannot ask, or the journey is not ours to ask about)
        // support exactly the same statement, and neither supports "is published".
        case .couldNotCheck, .notChecked:
            return "This journey is marked as published on this device. That has not been verified against the live showcase, so what is actually on the web may differ."
        }
    }

    // MARK: - Actions (functional: CloudKit mode + entitled build)

    @ViewBuilder
    private var actionSection: some View {
        if !isOwner {
            participantSection
        } else {
            ownerActionSection
        }
    }

    /// Shown when the journey was shared into this account: no publish/update/remove controls,
    /// because managing the world-readable mirror is the owner's decision (and only `_creator`
    /// can write the public records). (finding #6.)
    private var participantSection: some View {
        Section {
            EmptyView()
        } footer: {
            Text("Only the journey's owner can manage the public showcase. This journey was shared with you, so whether it appears on the world-readable showcase is controlled on the owner's device.")
        }
    }

    @ViewBuilder
    private var ownerActionSection: some View {
        Section {
            switch model.phase {
            case .idle, .failed:
                // Publishing is never paywalled (plan §5: the free tier's one journey is fully
                // finishable) — the only gate left is ownership, and this branch only runs for the
                // owner (see `actionSection` above).
                if !live.isPublic {
                    worldReadableConsent
                }
                Button {
                    Task { await runPublish() }
                } label: {
                    Label(publishButtonTitle, systemImage: "icloud.and.arrow.up")
                }
                .disabled(!canPublish)
                .foregroundStyle(canPublish ? Theme.accent : Theme.textTertiary)

                if live.isPublic {
                    // QUA-65: this was the only destructive action across the consumption
                    // surfaces without a confirmation — yet unpublishing kills a world-shared
                    // link for everyone holding it, and a later re-publish may land under a
                    // different slug in the collision case. House style: consequence-stating
                    // copy, like delete-journey and stop-sharing.
                    Button(role: .destructive) {
                        showingRemoveConfirm = true
                    } label: {
                        Label("Remove from showcase", systemImage: "globe.badge.chevron.backward")
                    }
                    .confirmationDialog("Remove from showcase?",
                                        isPresented: $showingRemoveConfirm,
                                        titleVisibility: .visible) {
                        Button("Remove from showcase", role: .destructive) {
                            Task { await runRemove() }
                        }
                        Button("Keep published", role: .cancel) {}
                    } message: {
                        Text("The public link stops working for everyone who has it. Your journey and photos are not affected.")
                    }
                }

                if case .failed(let message) = model.phase {
                    Text(message).font(.footnote).foregroundStyle(Theme.warning)
                }

            case .working:
                VStack(alignment: .leading, spacing: 8) {
                    ProgressView(value: model.progress?.fraction ?? 0)
                        .tint(Theme.accent)
                    // `phase` is supplied by the publish service; the fallback is ours and so is
                    // the one that needs the catalogue.
                    Text(model.progress?.phase
                         ?? String(localized: "Working…",
                                   comment: "Showcase publish: placeholder before any phase is reported."))
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                }

            case .done(let report):
                resultView(report)
                Button("Done") { model.reset() }.foregroundStyle(Theme.accentText)
            }
        } header: {
            Text(live.isPublic ? "Manage" : "Publish")
        } footer: {
            Text("Publishing is last-write-wins: it overwrites the mirror with this device's copy and removes any showcase photos that no longer exist here.")
        }
    }

    /// The world-readable acknowledgement gate shown only for a still-private journey.
    private var worldReadableConsent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Publishing makes this journey's metadata and photo thumbnails world-readable — anyone with the link can view them without signing in.",
                  systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(Theme.warning)
            Toggle("Make this journey public", isOn: $acknowledgeWorldReadable)
                .tint(Theme.accent)
                .font(.subheadline)
                .foregroundStyle(Theme.textPrimary)
        }
    }

    /// A private journey needs the explicit consent toggle; a public one can always update.
    private var canPublish: Bool { live.isPublic || acknowledgeWorldReadable }

    /// "Update showcase" claims there is something up there to update. When the live mirror says
    /// there is not, the honest verb is Publish — and it is also the action that actually helps
    /// (QUA-45). The consent gate is not re-imposed: the flag records that this owner already agreed
    /// to world-readability for this journey, and re-asking would read as a new decision.
    private var publishButtonTitle: LocalizedStringKey {
        if case .notOnShowcase = model.verification { return "Publish to showcase" }
        return live.isPublic ? "Update showcase" : "Publish to showcase"
    }

    private func resultView(_ report: PublicMirrorReport) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(report.wasCancelled ? "Cancelled"
                 : (report.succeeded ? "Showcase updated" : "Finished with some failures"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(report.succeeded ? Theme.textPrimary : Theme.warning)
            labelled("Published", String(localized: "\(report.published) records",
                                     comment: "Showcase publish report: how many records reached the public mirror."))
            if report.skippedNoThumb > 0 {
                labelled("Skipped (no thumbnail)", "\(report.skippedNoThumb)")
            }
            if report.deleted > 0 {
                labelled("Removed", "\(report.deleted)")
            }
            // QUA-25: the per-journey cap holds photographs back rather than failing the publish, so
            // the owner has to be told which ones did not go. Silently publishing 200 of 939 would be
            // the same class of dishonesty as the unpublish that reported success (DIFF-01).
            if report.photosHeldBack > 0 {
                labelled("Not published",
                         String(localized: "\(report.photosHeldBack) photos over the showcase limit",
                                comment: "Showcase publish report: photographs the per-journey cap held back."))
            }
            if report.failed > 0 {
                labelled("Failed", "\(report.failed)")
            }
            // The point of publishing. Without this the owner had no way to obtain the URL at all,
            // which left the growth loop — every published journey is meant to be a shareable page —
            // with no first step. Built from `report.publishedSlug` rather than `target.slug`,
            // because a cross-owner collision publishes under an owner-scoped variant and a link
            // made from the pretty slug would 404 for exactly the second family to publish.
            if let slug = report.publishedSlug, let url = AppInfo.showcaseURL(slug: slug) {
                Divider().padding(.vertical, 6)
                ShareLink(item: url) {
                    Label("Share the link", systemImage: "square.and.arrow.up")
                        .font(.subheadline.weight(.medium))
                }
                .buttonStyle(.borderedProminent)
                Text(url.absoluteString)
                    .font(.caption2.monospaced())
                    .foregroundStyle(Theme.textSecondary)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .accessibilityLabel("Showcase link, \(url.absoluteString)")
            }
        }
    }

    private func labelled(_ title: LocalizedStringKey, _ value: String) -> some View {
        HStack {
            Text(title).font(.caption).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value).font(.caption).foregroundStyle(Theme.textPrimary)
        }
    }

    // MARK: - Unavailable (fixtures / local mode, or unentitled build)

    private var unavailableSection: some View {
        Section {
            EmptyView()
        } footer: {
            Text("Publishing to the public showcase needs the CloudKit build with an iCloud account, running in \(PersistenceMode.cloudKit.label) mode. This app is currently in \(store.mode.label) mode, so the showcase can only be managed once CloudKit sync is active.")
        }
    }

    // MARK: - Drive the model

    private func runPublish() async {
        // Publishing tens of MB over cellular with Wi-Fi-only downloads on: WARN, don't block. The
        // mirror is small enough that publishing now can be a deliberate choice — unlike the
        // multi-GB photo download, which the policy defers outright. Photo ingest uploads (the user
        // just picked photos) are never gated: those are expected and user-initiated.
        if networkPolicy.wifiOnlyDownloads && networkPolicy.isExpensivePath {
            showCellularPublishConfirm = true
            return
        }
        performPublish()
    }

    private func performPublish() {
        // The domain flag is flipped by the model AFTER the mirror write succeeds — never before,
        // so a failed publish can never leave the UI claiming the journey is world-readable when
        // nothing was written. (findings #5 / #9 / #10.)
        let target = live
        let store = self.store
        model.publish(journey: target,
                      photos: store.photos(forJourneyID: target.id),
                      isOwner: isOwner) { makePublic in
            store.setJourneyPublic(makePublic, forJourney: target.id)
        }
    }

    private func runRemove() async {
        // Run the unpublish first; only flip to Private once every record is gone. A failed
        // unpublish leaves the journey showing Public (with the Remove button still available) so
        // the world-readable mirror is never silently misrepresented as private. (finding #5.)
        let target = live
        let store = self.store
        model.remove(slug: target.slug, isOwner: isOwner) { makePublic in
            store.setJourneyPublic(makePublic, forJourney: target.id)
        }
    }
}

/// Drives the Showcase sheet. Mirrors `CloudKitImportViewModel`'s gating: the real write is a
/// **compile-time** gate (`#if AKASHIC_CLOUDKIT_BUILD`) because constructing a `CKContainer`
/// without the iCloud entitlement traps (SIGTRAP) — the runtime `accountStatus()` check can only
/// ever be the second line of defense.
@MainActor
final class ShowcaseViewModel: ObservableObject {
    enum Phase: Equatable {
        case idle
        case working
        case done(PublicMirrorReport)
        case failed(String)
    }

    /// What the LIVE mirror says about this journey, versus what the local flag claims (QUA-45).
    ///
    /// `notChecked` is the honest starting state and also the resting state on every build that
    /// cannot ask (fixtures/local mode, un-entitled build) and for a non-owner. The UI must render
    /// `notChecked`, `checking` and `couldNotCheck` all as "marked as published, not verified" —
    /// only `onShowcase` licenses a claim about the web.
    enum MirrorVerification: Equatable {
        case notChecked
        case checking
        case onShowcase(slug: String)
        case notOnShowcase
        case couldNotCheck(String)
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var progress: PublicMirrorProgress?
    @Published private(set) var verification: MirrorVerification = .notChecked

    private var task: Task<Void, Never>?
    /// Separate from `task` so a verification in flight never blocks (or is mistaken for) a
    /// publish/remove, and so `awaitCurrentOperation` keeps meaning what it did.
    private var verifyTask: Task<Void, Never>?

    /// The outcome of resolving the mirror publisher: either a ready publisher, or a user-facing
    /// reason it is unavailable (no iCloud account / unentitled build).
    enum MirrorResolution {
        case ready(PublicMirrorPublishing)
        case unavailable(String)
    }

    /// Seam: resolve the mirror publisher, checking the iCloud account behind the entitlement gate.
    /// Injectable so the ordering + failure handling below is unit-tested without a live container
    /// — the whole point the review flagged as having zero coverage.
    typealias MirrorResolver = () async -> MirrorResolution
    private let resolveMirror: MirrorResolver

    init(resolveMirror: MirrorResolver? = nil) {
        self.resolveMirror = resolveMirror ?? ShowcaseViewModel.productionResolver
    }

    var isWorking: Bool { if case .working = phase { return true } else { return false } }

    /// The real write is only available in a CloudKit-entitled build (compile-time gate).
    var realRunAvailable: Bool {
        #if AKASHIC_CLOUDKIT_BUILD
        return true
        #else
        return false
        #endif
    }

    static let notOwnerMessage = String(localized: "Only the journey's owner can manage the public showcase.",
                                        comment: "Showcase: shown to someone a journey was shared with.")

    func reset() {
        guard !isWorking else { return }
        phase = .idle
        progress = nil
    }

    /// Publish (or update) a journey's public mirror, then — only if the mirror write succeeded —
    /// flip its `isPublic` flag via `setPublic`. `setPublic` returns whether the local flag write
    /// landed; a false is surfaced rather than ignored. `isOwner` is enforced here as a second line
    /// of defense (the UI also hides the controls for a non-owner). (findings #5 / #6 / #9.)
    func publish(journey: Journey, photos: [Photo], isOwner: Bool,
                 setPublic: @escaping (Bool) -> Bool) {
        guard !isWorking else { return }
        guard isOwner else { phase = .failed(Self.notOwnerMessage); return }
        run(flippingTo: true, setPublic: setPublic) { publisher in
            await publisher.publish(journey: journey, photos: photos) { [weak self] prog in
                Task { @MainActor in self?.progress = prog }
            }
        }
    }

    /// Remove a journey from the public mirror, then — only once every record is gone — flip its
    /// `isPublic` flag to false. A failed/partial unpublish leaves the flag TRUE (the UI keeps
    /// showing Public and the Remove button), never silently claiming Private while world-readable
    /// records remain. (findings #5 / #6.)
    func remove(slug: String, isOwner: Bool, setPublic: @escaping (Bool) -> Bool) {
        guard !isWorking else { return }
        guard isOwner else { phase = .failed(Self.notOwnerMessage); return }
        run(flippingTo: false, setPublic: setPublic) { publisher in
            await publisher.unpublish(slug: slug) { [weak self] prog in
                Task { @MainActor in self?.progress = prog }
            }
        }
    }

    func cancel() {
        task?.cancel()
    }

    /// Ask the live public database whether `slug` is actually on the showcase (QUA-45).
    ///
    /// Read-only and cheap — one or two record fetches, no assets — so it runs whenever the sheet
    /// opens on a journey whose flag says published. It exists because the flag cannot answer the
    /// question the sheet was answering with it: see `PublicMirrorPresence` for the measurement and
    /// for why per-environment scoping of the flag was rejected.
    func verifyPresence(slug: String) {
        guard case .notChecked = verification else { return }   // one check per sheet presentation
        verification = .checking
        verifyTask = Task {
            switch await self.resolveMirror() {
            case .unavailable(let message):
                self.verification = .couldNotCheck(message)
            case .ready(let publisher):
                switch await publisher.presence(ofJourneySlug: slug) {
                case .present(let found): self.verification = .onShowcase(slug: found)
                case .absent: self.verification = .notOnShowcase
                case .unknown(let why): self.verification = .couldNotCheck(why)
                }
            }
        }
    }

    /// Test hook: await the in-flight publish/remove task, if any (mirrors the engine's
    /// `awaitActivationFetch`), so a test can assert on the settled phase without racing it.
    func awaitCurrentOperation() async { await task?.value }

    /// Test hook: await the in-flight presence check.
    func awaitVerification() async { await verifyTask?.value }

    /// Shared harness: resolve the publisher (account + entitlement gate), run `body`, and flip the
    /// domain flag ONLY when the network op actually did what the flag would claim.
    ///
    ///   * publish   → mark Public once the world-readable journey record has landed. A failed
    ///                 publish never marks Public, so the label never over-claims exposure.
    ///   * unpublish → mark Private only when every record was removed. A failed/partial unpublish
    ///                 keeps it Public, so the label never under-claims exposure (the leak case).
    private func run(flippingTo newPublic: Bool,
                     setPublic: @escaping (Bool) -> Bool,
                     _ body: @escaping (PublicMirrorPublishing) async -> PublicMirrorReport) {
        phase = .working
        progress = PublicMirrorProgress(fraction: 0,
                                        phase: String(localized: "Starting",
                                                      comment: "Showcase publish: first progress phase."))
        task = Task {
            switch await self.resolveMirror() {
            case .unavailable(let message):
                self.phase = .failed(message)
            case .ready(let publisher):
                let report = await body(publisher)
                let networkOK = newPublic ? report.journeyPublished : report.succeeded
                if networkOK {
                    // A completed network op is itself first-hand evidence about the mirror, so
                    // record it rather than making the sheet say "unverified" straight after a
                    // publish it just watched succeed (QUA-45). A publish that landed knows the slug
                    // it landed under; an unpublish flips the flag to false, after which the
                    // verification is not consulted at all.
                    self.verification = newPublic
                        ? (report.publishedSlug.map(MirrorVerification.onShowcase(slug:)) ?? .notChecked)
                        : .notChecked
                    if !setPublic(newPublic) {
                        // The mirror op landed but the local flag write failed — do NOT claim
                        // success (that would leave state and reality disagreeing). Surface it in a
                        // retryable state. (findings #9 / #11.)
                        self.phase = .failed(newPublic ? Self.publishFlagWriteFailed : Self.removeFlagWriteFailed)
                        return
                    }
                }
                self.phase = .done(report)
            }
        }
    }

    static let publishFlagWriteFailed = String(
        localized: "The showcase was updated, but this device could not save the Public flag locally. The journey may still show as Private here — reopen and try again.",
        comment: "Showcase: publish succeeded remotely but the local flag write failed.")
    static let removeFlagWriteFailed = String(
        localized: "The showcase was removed, but this device could not save the Private flag locally. The journey may still show as Public here — reopen and try again.",
        comment: "Showcase: unpublish succeeded remotely but the local flag write failed.")

    /// Production resolver: build the public database behind the entitlement gate and confirm an
    /// available iCloud account.
    static func productionResolver() async -> MirrorResolution {
        #if AKASHIC_CLOUDKIT_BUILD
        let container = CKContainer(identifier: Config.cloudKitContainerIdentifier)
        let status = (try? await container.accountStatus()) ?? .couldNotDetermine
        guard status == .available else {
            return .unavailable(String(localized: "No iCloud account available. Sign in (Settings → iCloud) and try again.",
                                   comment: "Showcase: shown when publishing needs an iCloud account."))
        }
        // The current user's record name lets the publisher detect a cross-user slug collision in
        // the global public keyspace and publish under a disambiguated slug. (quality gate: slug
        // collision in the public showcase.)
        let ownerRecordName = try? await container.userRecordID().recordName
        return .ready(PublicMirrorPublisher(database: container.publicCloudDatabase,
                                            ownerRecordName: ownerRecordName))
        #else
        return .unavailable("Publishing to the showcase requires the Debug-CloudKit / Release-CloudKit build.")
        #endif
    }
}
