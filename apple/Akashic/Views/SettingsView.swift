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

    // Import state.
    @State private var bundlePath = Config.importBundlePath
    @State private var mediaRoot = Config.importMediaRoot
    @State private var showFolderPicker = false

    var body: some View {
        Form {
            Section("Active store") {
                labelled("Mode", store.mode.label)
                labelled("Journeys loaded", "\(store.journeys.count)")
                labelled("Photos in store", "\(store.photoCount)")
                labelled("CloudKit container", Config.cloudKitContainerIdentifier)
                labelled("CloudKit enabled (build flag)", FeatureFlags.cloudKitEnabled ? "Yes" : "No")
            }

            importSection

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
