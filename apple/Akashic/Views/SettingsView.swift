import SwiftUI
import UniformTypeIdentifiers

/// Debug settings: inspect and override the persistence mode, and import the real family
/// data from a Supabase export bundle (T2.4).
///
/// The store is built once at launch (`PersistenceController.shared`), so changing the
/// override takes effect on the next launch. This is the manual escape hatch for flipping
/// the app onto a real CloudKit / local store during bring-up.
struct SettingsView: View {
    @EnvironmentObject private var store: JourneyStore
    @State private var override: PersistenceMode?
    @State private var showRelaunchNote = false

    /// Live sync state, so a stalled or erroring engine is visible instead of silent.
    @ObservedObject private var syncStatus = PersistenceController.shared.syncStatus

    // Import state.
    @State private var bundlePath = Config.importBundlePath
    @State private var mediaRoot = Config.importMediaRoot
    @State private var showFolderPicker = false

    // CloudKit import (T2.5).
    @StateObject private var ckImport = CloudKitImportViewModel()
    @State private var showCloudKitConfirm = false

    var body: some View {
        Form {
            Section("Active store") {
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
                .foregroundStyle(Theme.accent)
            } header: {
                Text("Override (debug)")
            } footer: {
                Text("CloudKit mode requires the Release-CloudKit build with entitlements and an iCloud account. Changes apply after relaunching the app.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Settings")
        .onAppear {
            if let raw = UserDefaults.standard.string(forKey: Config.persistenceModeOverrideKey) {
                override = PersistenceMode(rawValue: raw)
            }
        }
        .alert("Relaunch required", isPresented: $showRelaunchNote) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Quit and reopen Akashic for the new persistence mode to take effect.")
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
                .foregroundStyle(Theme.accent)

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
                        .foregroundStyle(Theme.accent)
                }
            }
        } header: {
            Text("Import from export bundle (T2.4)")
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

    private func labelled(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }
}

#Preview {
    NavigationStack { SettingsView() }
        .environmentObject(JourneyStore(persistence: .preview))
        .preferredColorScheme(.dark)
}
