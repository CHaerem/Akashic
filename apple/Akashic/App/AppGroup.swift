import Foundation

/// The shared App-Group identifier and its container URL — the ONLY channel a WidgetKit
/// extension has for reading the app's data (widgets run in a separate process/sandbox and
/// cannot touch the app's Core Data store directly).
///
/// TONIGHT: App Groups require a provisioning profile + the `com.apple.security.application-groups`
/// entitlement, which the **unsigned simulator build does not carry**. So `containerURL`
/// resolves to `nil` and every consumer degrades gracefully:
///   * `WidgetPublisher` writes nothing (the widget shows its bundled placeholder), and
///   * hero-thumbnail copying is skipped.
///
/// Enabling the `group.no.akashic` capability on BOTH the app target and the `AkashicWidgets`
/// extension (signing required — see README "Widgets & Spotlight") makes `containerURL`
/// resolve and the real data start flowing, with no code change.
enum AppGroup {
    /// Matches the value that must be added to the App-Group capability of both targets.
    static let identifier = "group.no.akashic"

    /// The shared container URL when the App-Group entitlement is present, else `nil`.
    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    }

    /// Whether the shared container is currently reachable (App Group configured + entitled).
    static var isAvailable: Bool { containerURL != nil }
}
