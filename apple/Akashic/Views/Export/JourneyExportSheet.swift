import SwiftUI

/// "Export journey" sheet: builds the archive off the main actor, reports progress, then hands
/// the file to the system share sheet (Files, AirDrop, Mail — wherever the user wants it).
struct JourneyExportSheet: View {
    let journey: Journey

    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @Environment(\.dismiss) private var dismiss

    @State private var phase: Phase = .idle
    @State private var includePhotos = true
    @State private var showPaywall = false

    private enum Phase: Equatable {
        case idle
        case working(Double)
        case done(URL, photoCount: Int, missing: Int)
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Toggle("Include original photos", isOn: $includePhotos)
                        .disabled(isWorking)
                } footer: {
                    Text(includePhotos
                         ? "The full-resolution files, exactly as they were taken. This can be large."
                         : "Only the route and the text — small, and quick to share.")
                }

                Section {
                    switch phase {
                    case .idle:
                        // Shared-in journeys are never paywalled — exporting your copy of shared
                        // content is a viewing-tier action. Only OWNED journeys require Complete.
                        if entitlements.canExport(isOwned: store.isOwnedByCurrentUser(journeyID: journey.id)) {
                            Button {
                                Task { await runExport() }
                            } label: {
                                Label("Create export", systemImage: "square.and.arrow.up.on.square")
                            }
                        } else {
                            exportUpsellRow
                        }

                    case .working(let fraction):
                        VStack(alignment: .leading, spacing: 8) {
                            ProgressView(value: fraction)
                            Text("Packaging…")
                                .font(.caption)
                                .foregroundStyle(Theme.textSecondary)
                        }

                    case .done(let url, let photoCount, let missing):
                        ShareLink(item: url) {
                            Label("Save or share", systemImage: "square.and.arrow.up")
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(photoCount) photo\(photoCount == 1 ? "" : "s") included")
                                .font(.caption)
                                .foregroundStyle(Theme.textSecondary)
                            if missing > 0 {
                                Text("\(missing) photo\(missing == 1 ? "" : "s") could not be included — "
                                     + "their files are not on this device yet.")
                                    .font(.caption)
                                    .foregroundStyle(Theme.warning)
                            }
                        }

                    case .failed(let message):
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(Theme.warning)
                        Button("Try again") { phase = .idle }
                    }
                } header: {
                    Text("Export")
                } footer: {
                    Text("A .zip containing route.gpx, journey.json and the photos. "
                         + "Everything opens without Akashic.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Export")
            .navigationBarTitleDisplayMode(.inline)
            // Block interactive swipe-dismiss while the archive is being built, matching the
            // disabled Done button. (finding #8.)
            .interactiveDismissDisabled(isWorking)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.tint(Theme.accent)
                        .disabled(isWorking)
                }
            }
            .sheet(isPresented: $showPaywall) {
                PaywallView(reason: .export).environmentObject(entitlements)
            }
        }
    }

    /// Inline upsell shown in place of the export action for a free user. Export (the "exit door")
    /// is an Akashic Complete feature — the data stays fully visible in-app either way.
    private var exportUpsellRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Export is part of Akashic Complete", systemImage: "star.circle")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            Text("Package this journey — route, photos and notes — as a portable archive you can save or share.")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            Button { showPaywall = true } label: {
                Text("Unlock with Akashic Complete")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.accent)
            }
        }
    }

    private var isWorking: Bool { if case .working = phase { return true } else { return false } }

    private func runExport() async {
        phase = .working(0)
        var photos = includePhotos ? store.photos(forJourneyID: journey.id) : []
        // v2: originals live on PhotoMedia records (excluded media zone), so an export must first
        // stream any that are not on this device (MAPPING §13). Best-effort — whatever still can't
        // be fetched stays in the honest `missingPhotos` list. Then re-read so the freshly stored
        // local paths are picked up.
        if includePhotos, let fetcher = store.mediaFetcher, !photos.isEmpty {
            await fetcher.prefetchOriginals(for: photos)
            photos = store.photos(forJourneyID: journey.id)
        }
        // Comments are stored per day; the export wants the whole journey's worth.
        let comments = journey.camps.flatMap { store.commentService.comments(forWaypoint: $0.id) }
        let journey = self.journey
        let includePhotos = self.includePhotos

        do {
            let result = try await Task.detached(priority: .userInitiated) { () throws -> JourneyExporter.Result in
                // Each export gets its own directory, so a rerun never mixes with the previous
                // archive and cleanup is a single removeItem.
                let workspace = try ExportWorkspace.make()
                var options = JourneyExporter.Options()
                options.includePhotos = includePhotos
                let exporter = JourneyExporter()
                let written = try exporter.writeExport(journey: journey,
                                                       photos: photos,
                                                       comments: comments,
                                                       into: workspace,
                                                       options: options)
                let zipped = try ExportArchive.zip(folder: written.fileURL)
                return JourneyExporter.Result(fileURL: zipped,
                                              photoCount: written.photoCount,
                                              missingPhotos: written.missingPhotos)
            }.value

            phase = .done(result.fileURL,
                          photoCount: result.photoCount,
                          missing: result.missingPhotos.count)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
}

/// Scratch space for exports, under Caches so the system can reclaim it if storage runs short —
/// an export is a transient artifact, not something to back up or keep forever.
enum ExportWorkspace {
    static func make(fileManager: FileManager = .default) throws -> URL {
        let base = try fileManager.url(for: .cachesDirectory, in: .userDomainMask,
                                       appropriateFor: nil, create: true)
            .appendingPathComponent("Exports", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// Drop every previous export. Called at launch: the files are only needed until the user
    /// has shared them, and a 5 GB archive left in Caches is a real cost on a phone.
    static func purge(fileManager: FileManager = .default) {
        guard let base = try? fileManager.url(for: .cachesDirectory, in: .userDomainMask,
                                              appropriateFor: nil, create: false)
            .appendingPathComponent("Exports", isDirectory: true) else { return }
        try? fileManager.removeItem(at: base)
    }
}
