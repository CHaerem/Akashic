import Foundation

/// Where the app reads/writes its data.
enum PersistenceMode: String, CaseIterable, Identifiable {
    /// In-memory store seeded from the recovered fixtures. Default until CloudKit is wired.
    case fixtures
    /// Plain on-disk Core Data store (offline, no sync).
    case local
    /// `NSPersistentCloudKitContainer` mirroring to `iCloud.no.akashic` (needs entitlements).
    case cloudKit

    var id: String { rawValue }

    var label: String {
        switch self {
        case .fixtures: return "Fixtures (in-memory)"
        case .local: return "Local (on-disk)"
        case .cloudKit: return "CloudKit sync"
        }
    }
}

/// Static build-time feature flags. Flip `cloudKitEnabled` once the CloudKit container +
/// entitlements are configured (and build the `Release-CloudKit` configuration).
enum FeatureFlags {
    static let cloudKitEnabled = false
}

/// App configuration + the resolved persistence mode.
///
/// A debug override lives in `UserDefaults` under `Config.persistenceModeOverrideKey`
/// and is surfaced by the in-app Settings screen. When absent, the mode follows
/// `FeatureFlags.cloudKitEnabled`.
enum Config {
    static let cloudKitContainerIdentifier = "iCloud.no.akashic"
    static let coreDataModelName = "Akashic"
    static let persistenceModeOverrideKey = "akashic.persistenceMode.override"

    static var resolvedPersistenceMode: PersistenceMode {
        if let raw = UserDefaults.standard.string(forKey: persistenceModeOverrideKey),
           let mode = PersistenceMode(rawValue: raw) {
            return mode
        }
        return FeatureFlags.cloudKitEnabled ? .cloudKit : .fixtures
    }

    static func setPersistenceModeOverride(_ mode: PersistenceMode?) {
        let defaults = UserDefaults.standard
        if let mode {
            defaults.set(mode.rawValue, forKey: persistenceModeOverrideKey)
        } else {
            defaults.removeObject(forKey: persistenceModeOverrideKey)
        }
    }
}
