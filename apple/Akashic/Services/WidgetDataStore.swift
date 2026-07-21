import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Reads/writes `WidgetSnapshot`s to the shared App-Group container so the app (writer) and the
/// `AkashicWidgets` extension (reader) can exchange precomputed data across process boundaries.
///
/// Pure snapshot file-I/O only — deliberately free of any `Journey`/domain dependency so it can
/// be compiled into both targets. The `Journey → Snapshot` orchestration (and thumbnail
/// copying) lives in the app-only `WidgetPublisher`.
///
/// WITHOUT an App Group (`directory == nil`, the case tonight on the unsigned simulator build)
/// `write` is a no-op and `load` returns `[]` — the widget then falls back to its bundled
/// placeholder. See `AppGroup` / README "Widgets & Spotlight".
struct WidgetDataStore {
    /// App-wide instance, backed by the real App-Group container (nil today).
    static let shared = WidgetDataStore()

    /// Filename inside the shared container.
    static let fileName = "widget-snapshots.json"

    /// The shared container directory, or `nil` when no App Group is available. Injectable so
    /// unit tests can round-trip against a temp directory.
    let directory: URL?

    init(directory: URL? = AppGroup.containerURL) {
        self.directory = directory
    }

    private var fileURL: URL? { directory?.appendingPathComponent(Self.fileName) }

    /// Persist snapshots to the shared container. Returns `false` (no-op) when unavailable.
    @discardableResult
    func write(_ snapshots: [WidgetSnapshot]) -> Bool {
        guard let fileURL else { return false }
        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(snapshots)
            try data.write(to: fileURL, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    /// Load snapshots from the shared container. Returns `[]` when unavailable or unreadable.
    func load() -> [WidgetSnapshot] {
        guard let fileURL,
              let data = try? Data(contentsOf: fileURL),
              let snapshots = try? JSONDecoder().decode([WidgetSnapshot].self, from: data)
        else { return [] }
        return snapshots
    }

    /// Ask WidgetKit to refresh all timelines. Skipped under XCTest so the unit suite stays
    /// side-effect free; a no-op when the process has no installed widgets.
    func reloadTimelines() {
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
