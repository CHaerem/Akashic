import SwiftUI
import UniformTypeIdentifiers

/// The app's Settings screen, split into two audiences (COMMERCIALIZATION-PLAN §4.3):
///
///   * **Consumer** (always visible): the honest sync status one-liner, a human storage summary,
///     the "Your name" field used for comments, an export reminder, "Replay intro", the
///     legal/support links, and the app version.
///   * **Developer** (hidden): the migration workshop — active-store inspector, the T2.5 export
///     bundle importer, the T2.5 CloudKit importer, and the persistence-mode override. Nothing is
///     deleted; the runbook still needs these tools. The section is revealed by seven taps on the
///     version row (see `DeveloperTools`) and is always visible in DEBUG builds.
///
/// The store is built once at launch (`PersistenceController.shared`), so changing the persistence
/// override takes effect on the next launch.
struct SettingsView: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var onboarding: OnboardingCoordinator
    @EnvironmentObject private var entitlements: EntitlementStore
    @State private var override: PersistenceMode?
    @State private var showRelaunchNote = false
    @State private var showPaywall = false

    /// Live sync state, so a stalled or erroring engine is visible instead of silent.
    @ObservedObject private var syncStatus = PersistenceController.shared.syncStatus

    /// Wi-Fi-only download policy — the toggle below binds to it.
    @ObservedObject private var networkPolicy = NetworkPolicy.shared

    /// A5 — appearance override. Automatic is the default and leaves the system in charge.
    @AppStorage(AppearancePreference.storageKey) private var appearance: AppearancePreference = .automatic

    // "Your name" for comments — loaded from CommentService on appear, written back on change.
    @State private var authorName = ""

    // Developer-gate state.
    @State private var developerUnlocked = DeveloperTools.isUnlocked()
    @State private var versionTapCount = 0

    /// DIFF-16 — the DIAGNOSTICS gate, deliberately separate from the developer gate above.
    ///
    /// `DeveloperTools.isUnlocked()` returns false in Release unconditionally (SHIP-09) and the whole
    /// workshop is compiled out, which is right: a persistence-mode override that can repoint the
    /// customer's store has no business in a paid binary. But that left a signed build with **no way
    /// to be diagnosed at all** — the failure DIFF-16 exists to fix, measured on TestFlight build 101,
    /// where DIFF-15's journey rows did not render and every line explaining why went to a logger only
    /// an environment variable could enable. So the persisted seven-tap flag, which `isUnlocked()`
    /// deliberately ignores, gates one extra section here, and that section contains exactly one
    /// switch that turns logging on. Nothing it holds writes data, moves a store, or spends money.
    @State private var diagnosticsUnlocked = SettingsView.diagnosticsAreUnlocked()

    /// Live state of the persisted sync-log switch. Seeded from and written back through `SyncLog`,
    /// so that type stays the single owner of its key.
    @State private var syncLoggingEnabled = SyncLog.isPersistentlyEnabled()

    /// DEBUG auto-reveals (like the workshop); Release reveals on the persisted seven-tap flag.
    static func diagnosticsAreUnlocked() -> Bool {
        DeveloperTools.isUnlocked() || DeveloperTools.isPersistentlyUnlocked()
    }

    // Import state.
    @State private var bundlePath = Config.importBundlePath
    @State private var mediaRoot = Config.importMediaRoot
    @State private var showFolderPicker = false

    // CloudKit import (T2.5).
    @StateObject private var ckImport = CloudKitImportViewModel()
    @State private var showCloudKitConfirm = false

    var body: some View {
        Form {
            consumerSections

            // DIFF-16: present in EVERY configuration, unlike the workshop below. This is the whole
            // point — a TestFlight build must be able to produce a sync log the owner can read.
            if diagnosticsUnlocked {
                diagnosticsSection
            }

            // SHIP-09: compiled out of Release entirely, not merely hidden. `DeveloperTools`
            // already returns false there, so this is the second of two independent guards — the
            // point being that the workshop should not be *present* in a customer's binary, so
            // there is nothing for a future refactor to accidentally re-expose.
            #if DEBUG
            if developerUnlocked {
                developerSections
            }
            #endif
        }
        .scrollContentBackground(.hidden)
        // D2: a `Form` has no natural width cap of its own and otherwise runs the full width of
        // a 13" iPad — the developer sections in particular (dense key/value rows) read as
        // stretched-phone at that width more than any other screen in the app.
        .constrainedReadingWidth()
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Settings")
        .onAppear {
            authorName = store.commentService.authorName ?? ""
            if let raw = UserDefaults.standard.string(forKey: Config.persistenceModeOverrideKey) {
                override = PersistenceMode(rawValue: raw)
            }
        }
        .alert("Relaunch required", isPresented: $showRelaunchNote) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Quit and reopen Akashic for the new persistence mode to take effect.")
        }
        .sheet(isPresented: $showPaywall) {
            PaywallView(reason: .settings).environmentObject(entitlements)
        }
        .fileImporter(isPresented: $showFolderPicker,
                      allowedContentTypes: [.folder]) { result in
            if case let .success(url) = result {
                bundlePath = url.path
                mediaRoot = Config.defaultMediaRoot(forBundlePath: url.path)
                persistImportPaths()
            }
        }
        .alert(ckImport.environment == .production
               ? "Import to PRODUCTION CloudKit?"
               : "Import to CloudKit?",
               isPresented: $showCloudKitConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Upload", role: .destructive) {
                persistImportPaths()
                ckImport.runRealImport(bundlePath: bundlePath, mediaRoot: mediaRoot)
            }
        } message: {
            Text(importConfirmationMessage)
        }
    }

    // MARK: - Consumer

    @ViewBuilder
    private var consumerSections: some View {
        Section {
            labelled("Status", syncStatus.summary)
            // While a heavy download is held back for Wi-Fi, offer an inline one-occasion cellular
            // override right here, so the user never has to hunt for the global toggle to unblock
            // one download. It does NOT change the "Wi-Fi only" setting below.
            if syncStatus.state == .waitingForWiFi {
                Button {
                    networkPolicy.grantOneOccasionCellularDownload()
                } label: {
                    Label("Download now over cellular", systemImage: "arrow.down.circle")
                        .foregroundStyle(Theme.accentText)
                }
            }
            // v2 one-time photo-storage repack progress, while it runs (MAPPING §13).
            if let repack = syncStatus.repackSummary {
                labelled("Storage", repack)
            }
            labelled("Library", Formatters.librarySummary(journeys: store.journeys.count,
                                                          photos: store.photoCount))
            Picker("Appearance", selection: $appearance) {
                ForEach(AppearancePreference.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
            Toggle("Download over Wi-Fi only", isOn: $networkPolicy.wifiOnlyDownloads)
                .tint(Theme.accent)
                .foregroundStyle(Theme.textPrimary)
        } header: {
            Text("iCloud sync")
        } footer: {
            // Says the globe stays dark out loud: choosing Light and finding the map unchanged
            // otherwise reads as a bug rather than as the deliberate immersive choice it is.
            Text("Photo downloads can reach several GB on first sync. The map stays dark in every appearance, so imagery keeps its contrast.")
        }

        Section {
            TextField("Your name", text: $authorName)
                .textFieldStyle(.plain)
                .foregroundStyle(Theme.textPrimary)
                .autocorrectionDisabled()
                .onChange(of: authorName) { _, newValue in
                    store.commentService.authorName = newValue
                }
        } header: {
            Text("Your name")
        } footer: {
            Text("Shown next to the comments you leave on your journeys.")
        }

        Section {
            Label {
                Text("Export a journey from its ⋯ menu — it bundles the route, photos, and notes into a file you can share or back up.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            } icon: {
                Image(systemName: "square.and.arrow.up")
                    .foregroundStyle(Theme.accentText)
            }

            Button {
                onboarding.replay()
            } label: {
                Label("Replay intro", systemImage: "sparkles")
                    .foregroundStyle(Theme.accentText)
            }
        } header: {
            Text("Your journeys")
        }

        Section {
            Button {
                // An entitled user already owns Complete — never present a live "buy" surface for
                // something they own (a wrong-state purchase UI). The row just shows their status.
                // (quality gate: Settings Membership row opens purchase UI for owners.)
                guard !entitlements.isComplete else { return }
                showPaywall = true
            } label: {
                HStack {
                    Label("Akashic Complete", systemImage: "star.circle")
                        .foregroundStyle(Theme.textPrimary)
                    Spacer()
                    // QUA-15: "Free" is a claim, and on a cold launch it is one we cannot make yet.
                    Text(entitlements.isEntitlementDetermined
                         ? (entitlements.isComplete ? "Complete ✓" : "Free")
                         : "Checking…")
                        .foregroundStyle(entitlements.isComplete ? Theme.accent : Theme.textSecondary)
                    if !entitlements.isComplete {
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
            }
            .disabled(entitlements.isComplete)
            // QUA-10: the paywall's `.settings` entry point, and the only one reachable without
            // first filling the free tier — so it is where the paywall-state tests start. See `A11yID`.
            .accessibilityIdentifier(A11yID.settingsComplete)
        } header: {
            Text("Membership")
        } footer: {
            Text(entitlements.isComplete
                 ? "Akashic Complete is active — unlimited journeys and photos. Shared with your Family Sharing group."
                 // §5 (revised): the free tier's one journey is fully finishable — export and
                 // showcase publishing are NOT part of what Complete adds; only the journey/photo
                 // limits are.
                 : "The free tier includes one journey (up to 100 photos), the full experience, sharing, export and publishing. Akashic Complete unlocks unlimited journeys and photos — one purchase, shared with your family. Restore a previous purchase from inside.")
        }

        Section("About") {
            Link(destination: AppInfo.privacyURL) {
                linkRow("Privacy Policy", systemImage: "hand.raised")
            }
            Link(destination: AppInfo.termsURL) {
                linkRow("Terms of Use", systemImage: "doc.text")
            }
            Link(destination: AppInfo.supportURL) {
                linkRow("Support", systemImage: "questionmark.circle")
            }
            // Version row doubles as the hidden developer-tools unlock (seven taps). Auto-unlocked
            // in DEBUG, so the tap counter only matters in Release.
            versionRow
        }
    }

    /// Version row, carrying the classic seven-tap unlock.
    ///
    /// **DIFF-16 changed this and the change is deliberate.** It used to be `#if DEBUG` only, on the
    /// correct reasoning that Release had nothing to unlock (SHIP-09 compiles the workshop out). The
    /// consequence, found on device: a signed build could not be made to log, so the one surface where
    /// DIFF-15 could fail was the one surface with no way to see why. The gesture now works in every
    /// configuration and reveals the DIAGNOSTICS section only — the workshop is still absent from a
    /// Release binary, guarded by both `#if DEBUG` and `DeveloperTools.isUnlocked()`'s hard `false`.
    private var versionRow: some View {
        labelled("Version", AppInfo.versionDisplay)
            .contentShape(Rectangle())
            .onTapGesture {
                guard !diagnosticsUnlocked else { return }
                versionTapCount += 1
                if DeveloperTools.tapsReachUnlock(versionTapCount) {
                    DeveloperTools.setUnlocked(true)
                    diagnosticsUnlocked = true
                }
            }
    }

    // MARK: - Diagnostics (DIFF-16)

    /// One switch, and it is the reason this task is sequenced first: **every candidate root cause for
    /// the device failure is a guess until the device can talk.**
    ///
    /// The log itself already existed and is thorough — `SyncLog` carries account status, fetch
    /// start/return, per-batch counts, send failures with CloudKit error codes, and the
    /// `remoteJourneySummaries` line that would have settled which of the three hypotheses is right.
    /// All of it was unreachable from an installed build, because `SyncLog.isEnabled` read an
    /// environment variable and TestFlight cannot set one.
    @ViewBuilder
    private var diagnosticsSection: some View {
        Section {
            Toggle("Sync logging", isOn: Binding(
                get: { syncLoggingEnabled },
                set: { newValue in
                    syncLoggingEnabled = newValue
                    SyncLog.setPersistentlyEnabled(newValue)
                    // Written through the switch that was just flipped, so the first line in the
                    // stream is itself proof the toggle took effect. This is also the assertion the
                    // unit test makes: `SyncLog.isEnabled` was a `static let`, evaluated once, and a
                    // toggle in front of a cached `let` does nothing at all while looking correct.
                    SyncLog.log("diagnostics: sync logging turned on from Settings")
                }))
                .tint(Theme.accent)
                .foregroundStyle(Theme.textPrimary)
            labelled("Log subsystem", "no.akashic.app · sync")
            Button(role: .destructive) {
                // Turning the section off turns the logging off with it: a switch nobody can see any
                // more must not be left on, quietly writing to the log store for the life of the
                // install.
                SyncLog.setPersistentlyEnabled(false)
                syncLoggingEnabled = false
                DeveloperTools.setUnlocked(false)
                diagnosticsUnlocked = Self.diagnosticsAreUnlocked()
            } label: {
                Label("Hide diagnostics", systemImage: "eye.slash")
            }
        } header: {
            Text("Diagnostics")
        } footer: {
            Text("Records what iCloud sync does — account status, fetch counts, zone names and failures — to the system log. Read it with Console.app while the device is connected, filtered on the subsystem above. Photos, captions and comments are never logged. Off by default.")
        }
    }

    private func linkRow(_ title: LocalizedStringKey, systemImage: String) -> some View {
        HStack {
            Label(title, systemImage: systemImage)
                .foregroundStyle(Theme.textPrimary)
            Spacer()
            Image(systemName: "arrow.up.right")
                .font(.caption)
                .foregroundStyle(Theme.textTertiary)
        }
    }

    // MARK: - Developer

    @ViewBuilder
    private var developerSections: some View {
        Section {
            labelled("Mode", store.mode.label)
            labelled("Journeys loaded", "\(store.journeys.count)")
            labelled("Photos in store", "\(store.photoCount)")
            labelled("CloudKit container", Config.cloudKitContainerIdentifier)
            // The build flag is a constant that is false in every configuration; what
            // actually selects CloudKit is AKASHIC_CLOUDKIT=1 or the Settings override. The
            // old row showed only the constant, so a CloudKit-mode run reported "No".
            labelled("CloudKit environment", cloudKitEnvironmentLabel)
            // Sync state was previously computed but never shown, so a stalled sync looked
            // identical to a working one — from the outside and from inside the app.
            labelled("Sync", syncStatus.summary)
        } header: {
            Text("Active store")
        } footer: {
            Text("Developer tools. Hidden from customers; revealed by seven taps on the version "
                 + "row and always shown in DEBUG builds.")
        }

        importSection

        cloudKitImportSection

        Section {
            Picker("Persistence mode", selection: Binding(
                get: { override ?? store.mode },
                set: { newValue in
                    override = newValue
                    Config.setPersistenceModeOverride(newValue)
                    showRelaunchNote = true
                }
            )) {
                ForEach(PersistenceMode.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.inline)

            Button("Clear override (follow build flag)") {
                override = nil
                Config.setPersistenceModeOverride(nil)
                showRelaunchNote = true
            }
            .foregroundStyle(Theme.accentText)

            Button(role: .destructive) {
                DeveloperTools.setUnlocked(false)
                versionTapCount = 0
                // Clearing the gate must also clear any simulated entitlement — otherwise the
                // device would keep reporting "Complete ✓" with no visible cause or control.
                // (quality gate: hide-developer-tools leaves Simulate Complete active.)
                entitlements.setSimulateComplete(false)
                developerUnlocked = DeveloperTools.isUnlocked()
            } label: {
                Label("Hide developer tools", systemImage: "eye.slash")
            }
        } header: {
            Text("Override (debug)")
        } footer: {
            Text("CloudKit mode requires the Release-CloudKit build with entitlements and an iCloud account. Changes apply after relaunching the app.")
        }

        // The entitlement toggle is compiled out of Release: even a hand-set UserDefaults key does
        // nothing there (see EntitlementOverride.resolvedOverride). (quality gate: paywall bypass.)
        #if DEBUG
        entitlementSection
        #endif
    }

    /// Developer override for the paywall (M3): flip the app into "Akashic Complete" without a
    /// real purchase, so we can exercise both entitlement states in development. **DEBUG only** —
    /// the whole toggle is compiled out of Release so it can never be a monetization bypass, and
    /// `EntitlementOverride.resolvedOverride` independently ignores the flag in Release. The
    /// `AKASHIC_COMPLETE=1` environment variable does the same for screenshots (also DEBUG-only).
    #if DEBUG
    @ViewBuilder
    private var entitlementSection: some View {
        Section {
            labelled("Entitlement", entitlements.isComplete ? "Complete" : "Free")
            Toggle("Simulate Akashic Complete", isOn: Binding(
                get: { entitlements.simulateComplete },
                set: { entitlements.setSimulateComplete($0) }
            ))
            .tint(Theme.accent)
        } header: {
            Text("Entitlement (debug)")
        } footer: {
            Text("Grants Akashic Complete locally without a purchase, for testing the paywall gates. "
                 + "Honors AKASHIC_COMPLETE=1 in the environment (screenshots), which overrides this toggle. "
                 + "Never downgrades a real purchase.")
        }
    }
    #endif

    /// Which CloudKit database this build talks to, and how the mode was chosen — the two
    /// facts you need before touching the import screen.
    private var cloudKitEnvironmentLabel: String {
        guard store.mode == .cloudKit else { return "not in CloudKit mode" }
        let source = FeatureFlags.cloudKitEnvOverride ? "env" : "override"
        return "\(CloudKitImportEnvironment.current.rawValue) (\(source))"
    }

    private var importConfirmationMessage: String {
        let target = "\(ckImport.containerID) · \(ckImport.environment.rawValue)"
        let scope = ckImport.environment == .production
            ? "This writes the REAL production database — the one TestFlight and App Store "
              + "builds read. Everything the family sees comes from here."
            : "This writes the Development database. Production is not touched."
        return "Uploads the full export to \(target) (the owner's private database). \(scope) "
            + "CloudKit sync must be quiesced first — the importer writes the private database "
            + "directly and must never run alongside the sync engine. Re-running is safe "
            + "(idempotent, no duplicates) but restarts the upload from the beginning."
    }

    // MARK: - CloudKit import section (T2.5)

    @ViewBuilder
    private var cloudKitImportSection: some View {
        Section {
            labelled("Target container", ckImport.containerID)
            labelled("Environment", ckImport.environment.rawValue)

            Button {
                persistImportPaths()
                ckImport.computePlan(bundlePath: bundlePath, mediaRoot: mediaRoot)
            } label: {
                HStack {
                    Image(systemName: "list.bullet.rectangle")
                    Text("Compute import plan (dry run)")
                    if ckImport.isRunning { Spacer(); ProgressView() }
                }
            }
            .disabled(ckImport.isRunning)
            .foregroundStyle(ckImport.isRunning ? Theme.textTertiary : Theme.accent)

            if let plan = ckImport.plan {
                cloudKitPlanView(plan)
            }

            if let progress = ckImport.progress, ckImport.isRunning {
                cloudKitProgressView(progress)
            }

            if ckImport.isRunning {
                Button(role: .destructive) { ckImport.cancel() } label: {
                    Label("Cancel", systemImage: "xmark.circle")
                }
            }

            if let message = ckImport.statusMessage {
                Text(message)
                    .font(.caption2.monospaced())
                    .foregroundStyle(Theme.textSecondary)
            }

            if let report = ckImport.report, !report.dryRun {
                cloudKitReportView(report)
            }

            // Real run — gated behind the CloudKit *build* (compile-time entitlement gate; a
            // CKContainer traps without the entitlement), the sync interlock, and confirmation.
            Button {
                showCloudKitConfirm = true
            } label: {
                Label("Run import to CloudKit…", systemImage: "icloud.and.arrow.up")
            }
            .disabled(!ckImport.canStartRealImport)
            .foregroundStyle(ckImport.canStartRealImport ? Theme.accent : Theme.textTertiary)

            if let reason = ckImport.realRunBlockedReason {
                Label(reason, systemImage: "exclamationmark.triangle")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            }
        } header: {
            Text("Import to CloudKit (T2.5)")
        } footer: {
            Text(ckImport.realRunAvailable
                 ? "Uploads per-journey zones (journey-<uuid>) to the owner's private DB. Idempotent: re-running creates no duplicates, but it restarts the upload from the beginning (nothing is persisted to resume from). CloudKit sync must not be running: the importer bypasses CKSyncEngine and both writing at once is unsafe."
                 : "Dry-run computes the full plan (no account or entitlement needed). The real upload requires the Debug-CloudKit / Release-CloudKit build with entitlements and an iCloud account signed into this device — the default build cannot even construct a CloudKit container.")
        }
    }

    private func cloudKitPlanView(_ plan: CloudKitImportPlan) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            labelled("Zones", "\(plan.zoneCount)")
            labelled("Records", "\(plan.recordCount) (\(plan.journeyCount)J / \(plan.waypointCount)W / \(plan.photoCount)P / \(plan.commentCount)C)")
            labelled("Assets", "\(plan.assetCount) · \(ByteCount.string(plan.totalAssetBytes))")
            labelled("  originals / thumbs", "\(plan.originalAssetCount) / \(plan.thumbAssetCount)")
            labelled("Upload ops", "\(plan.batchCount) batches")
            labelled("  hero images", "\(plan.heroAssetCount)/\(plan.heroAssetCount + plan.heroMissing)")
            labelled("Thumbs missing", "\(plan.thumbsMissing)")
            labelled("Heroes missing", "\(plan.heroMissing)")
            labelled("Skipped (no media)", "\(plan.missingMedia.count)")
        }
    }

    private func cloudKitProgressView(_ progress: CloudKitImportProgress) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            labelled("Journeys", "\(progress.journeysDone)/\(progress.journeysTotal)")
            ProgressView(value: progress.recordFraction) {
                Text("Records \(progress.recordsDone)/\(progress.recordsTotal)")
                    .font(.caption2).foregroundStyle(Theme.textSecondary)
            }
            ProgressView(value: progress.byteFraction) {
                Text("Uploaded \(ByteCount.string(progress.bytesDone)) / \(ByteCount.string(progress.bytesTotal))")
                    .font(.caption2).foregroundStyle(Theme.textSecondary)
            }
        }
        .tint(Theme.accent)
    }

    private func cloudKitReportView(_ report: CloudKitImportReport) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            labelled("Zones created", "\(report.zonesCreated)")
            labelled("Records saved", "\(report.recordsSaved)/\(report.plan.recordCount)")
            labelled("Bytes uploaded", ByteCount.string(report.bytesUploaded))
            labelled("Failures", "\(report.failures.count)")
            ForEach(report.failures.prefix(8)) { failure in
                Text("• \(failure.recordType) \(failure.recordName.prefix(8)) — \(failure.message)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.red)
            }
        }
    }

    // MARK: - Import section

    @ViewBuilder
    private var importSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("Export bundle path").font(.caption).foregroundStyle(Theme.textTertiary)
                TextField("/path/to/AkashicExport", text: $bundlePath, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.footnote.monospaced())
                    .foregroundStyle(Theme.textPrimary)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onChange(of: bundlePath) { _, _ in persistImportPaths() }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Media root (R2 objects)").font(.caption).foregroundStyle(Theme.textTertiary)
                TextField("/path/to/r2/objects", text: $mediaRoot, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.footnote.monospaced())
                    .foregroundStyle(Theme.textPrimary)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onChange(of: mediaRoot) { _, _ in persistImportPaths() }
            }

            Button("Choose folder…") { showFolderPicker = true }
                .foregroundStyle(Theme.accentText)

            Button {
                Task {
                    persistImportPaths()
                    await store.runLocalImport(bundlePath: bundlePath, mediaRoot: mediaRoot)
                }
            } label: {
                HStack {
                    Image(systemName: "square.and.arrow.down")
                    Text("Import from export bundle")
                    if store.isImporting {
                        Spacer(); ProgressView()
                    }
                }
            }
            .disabled(store.isImporting)
            .foregroundStyle(store.isImporting ? Theme.textTertiary : Theme.accent)

            if let progress = store.importProgress {
                progressRow(progress)
            }

            if let report = store.lastImportReport {
                reportView(report)
            }

            if store.photoCount > 0 {
                NavigationLink {
                    ImportBrowserView()
                } label: {
                    Label("Browse imported photos", systemImage: "photo.on.rectangle.angled")
                        .foregroundStyle(Theme.accentText)
                }
            }
        } header: {
            Text("Import from export bundle (T2.5)")
        } footer: {
            Text("The Simulator can read host paths directly. For results that persist across launches and show photos, switch the store to \(PersistenceMode.local.label) below, relaunch, then import. Re-importing preserves native edits — it only refreshes media paths and metadata.")
        }
    }

    @ViewBuilder
    private func progressRow(_ progress: ImportProgress) -> some View {
        switch progress {
        case .reading:
            labelled("Progress", "Reading export…")
        case let .importingJourneys(done, total):
            labelled("Progress", "Journeys \(done)/\(total)")
        case let .importingPhotos(done, total):
            labelled("Progress", "Photos \(done)/\(total)")
        case .saving:
            labelled("Progress", "Saving…")
        case .finished:
            labelled("Progress", "Done")
        case let .failed(message):
            VStack(alignment: .leading, spacing: 4) {
                Text("Import failed").foregroundStyle(.red).font(.footnote.weight(.semibold))
                Text(message).font(.caption2.monospaced()).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func reportView(_ report: ImportReport) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            labelled("Journeys", "\(report.journeysTotal) (\(report.journeysCreated) new)")
            labelled("Waypoints", "\(report.waypointsImported)")
            labelled("Photos", "\(report.photosTotal) (\(report.photosSkipped) skipped)")
            labelled("Thumbs on disk", "\(report.thumbsResolved)")
            labelled("Originals on disk", "\(report.originalsResolved)")
            labelled("Missing media", "\(report.photosMissingMedia)")
            labelled("Elapsed", String(format: "%.1fs", report.elapsed))
        }
    }

    private func persistImportPaths() {
        Config.importBundlePath = bundlePath
        Config.importMediaRoot = mediaRoot
    }

    private func labelled(_ title: LocalizedStringKey, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        // One element, not two (QUA-56). The values here are technical strings — a container ID, an
        // environment name — and as standalone elements VoiceOver reads them bare: "iCloud.no.akashic",
        // which `performAccessibilityAudit` correctly flags as not human-readable. Combined, the row
        // reads "Target container, iCloud.no.akashic": the title supplies the humanity and the value
        // stays exact. Found the day the audit first SAW these rows — they sit below the fold on an
        // iPhone SE, and the audit only audits what is instantiated, so until the tests scrolled,
        // `.sufficientElementDescription`'s "reports zero" was a claim about the top of the screen.
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    NavigationStack { SettingsView() }
        .environmentObject(JourneyStore(persistence: .preview))
        .environmentObject(OnboardingCoordinator(isPresented: false))
        .environmentObject(EntitlementStore.previewFree)
        .preferredColorScheme(.dark)
}
