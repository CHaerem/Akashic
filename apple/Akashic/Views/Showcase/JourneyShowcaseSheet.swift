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
    /// Explicit acknowledgement required before a *private* journey can be published
    /// world-readable (the consequence is spelled out in the warning above the toggle).
    @State private var acknowledgeWorldReadable = false

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
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.tint(Theme.accent)
                        .disabled(model.isWorking)
                }
            }
        }
    }

    // MARK: - Status

    private var statusSection: some View {
        Section {
            HStack {
                Label(live.isPublic ? "Public" : "Private",
                      systemImage: live.isPublic ? "globe" : "lock")
                    .foregroundStyle(live.isPublic ? Theme.accent : Theme.textSecondary)
                Spacer()
                Text(live.shortName).foregroundStyle(Theme.textSecondary)
            }
        } header: {
            Text("Public showcase")
        } footer: {
            Text(live.isPublic
                 ? "This journey is published to the world-readable showcase. Its route, day notes and photo thumbnails can be viewed on the web without signing in. Full-resolution photos are never uploaded."
                 : "This journey is private. Publishing copies its route, day notes and photo thumbnails to a world-readable showcase that anyone can view without signing in. Full-resolution photos stay on your devices.")
        }
    }

    // MARK: - Actions (functional: CloudKit mode + entitled build)

    @ViewBuilder
    private var actionSection: some View {
        Section {
            switch model.phase {
            case .idle, .failed:
                if !live.isPublic {
                    worldReadableConsent
                }
                Button {
                    Task { await runPublish() }
                } label: {
                    Label(live.isPublic ? "Update showcase" : "Publish to showcase",
                          systemImage: "icloud.and.arrow.up")
                }
                .disabled(!canPublish)
                .foregroundStyle(canPublish ? Theme.accent : Theme.textTertiary)

                if live.isPublic {
                    Button(role: .destructive) {
                        Task { await runRemove() }
                    } label: {
                        Label("Remove from showcase", systemImage: "globe.badge.chevron.backward")
                    }
                }

                if case .failed(let message) = model.phase {
                    Text(message).font(.footnote).foregroundStyle(Theme.warning)
                }

            case .working:
                VStack(alignment: .leading, spacing: 8) {
                    ProgressView(value: model.progress?.fraction ?? 0)
                        .tint(Theme.accent)
                    Text(model.progress?.phase ?? "Working…")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                }

            case .done(let report):
                resultView(report)
                Button("Done") { model.reset() }.foregroundStyle(Theme.accent)
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

    private func resultView(_ report: PublicMirrorReport) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(report.wasCancelled ? "Cancelled"
                 : (report.succeeded ? "Showcase updated" : "Finished with some failures"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(report.succeeded ? Theme.textPrimary : Theme.warning)
            labelled("Published", "\(report.published) record\(report.published == 1 ? "" : "s")")
            if report.skippedNoThumb > 0 {
                labelled("Skipped (no thumbnail)", "\(report.skippedNoThumb)")
            }
            if report.deleted > 0 {
                labelled("Removed", "\(report.deleted)")
            }
            if report.failed > 0 {
                labelled("Failed", "\(report.failed)")
            }
        }
    }

    private func labelled(_ title: String, _ value: String) -> some View {
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
        if !live.isPublic {
            // Flip the domain flag first so the journey reads as public everywhere (and the sync
            // engine carries the flag to the private DB). The mirror write follows.
            store.setJourneyPublic(true, forJourney: live.id)
        }
        let target = live
        model.publish(journey: target, photos: store.photos(forJourneyID: target.id))
    }

    private func runRemove() async {
        let slug = live.slug
        store.setJourneyPublic(false, forJourney: live.id)
        model.remove(slug: slug)
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

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var progress: PublicMirrorProgress?

    let containerID = Config.cloudKitContainerIdentifier

    private var task: Task<Void, Never>?

    var isWorking: Bool { if case .working = phase { return true } else { return false } }

    /// The real write is only available in a CloudKit-entitled build (compile-time gate).
    var realRunAvailable: Bool {
        #if AKASHIC_CLOUDKIT_BUILD
        return true
        #else
        return false
        #endif
    }

    func reset() {
        guard !isWorking else { return }
        phase = .idle
        progress = nil
    }

    func publish(journey: Journey, photos: [Photo]) {
        guard !isWorking else { return }
        run { publisher in
            await publisher.publish(journey: journey, photos: photos) { [weak self] prog in
                Task { @MainActor in self?.progress = prog }
            }
        }
    }

    func remove(slug: String) {
        guard !isWorking else { return }
        run { publisher in
            await publisher.unpublish(slug: slug) { [weak self] prog in
                Task { @MainActor in self?.progress = prog }
            }
        }
    }

    func cancel() {
        task?.cancel()
    }

    /// Shared harness: build the public database behind the entitlement gate, check the account,
    /// then run `body` against a `PublicMirrorPublisher`.
    private func run(_ body: @escaping (PublicMirrorPublisher) async -> PublicMirrorReport) {
        phase = .working
        progress = PublicMirrorProgress(fraction: 0, phase: "Starting")
        task = Task { [containerID] in
            #if AKASHIC_CLOUDKIT_BUILD
            let container = CKContainer(identifier: containerID)
            let status = (try? await container.accountStatus()) ?? .couldNotDetermine
            guard status == .available else {
                self.phase = .failed("No iCloud account available. Sign in (Settings → iCloud) and try again.")
                return
            }
            let publisher = PublicMirrorPublisher(database: container.publicCloudDatabase)
            let report = await body(publisher)
            self.phase = .done(report)
            #else
            self.phase = .failed("Publishing to the showcase requires the Debug-CloudKit / Release-CloudKit build.")
            #endif
        }
    }
}
