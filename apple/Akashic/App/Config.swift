import Foundation

/// Where the app reads/writes its data.
enum PersistenceMode: String, CaseIterable, Identifiable {
    /// In-memory store seeded from the recovered fixtures. Default until CloudKit is wired.
    case fixtures
    /// Plain on-disk Core Data store (offline, no sync).
    case local
    /// On-disk store with the `CKSyncEngine`-backed `AkashicSyncEngine` attached (D4), syncing
    /// custom record types to `iCloud.no.akashic`, one custom zone per journey. Needs the
    /// `Debug-CloudKit`/`Release-CloudKit` entitlements + an iCloud account to actually sync;
    /// stays local otherwise.
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
/// entitlements are configured (and build the `Debug-CloudKit` / `Release-CloudKit`
/// configuration). Even when true, the sync engine only *starts* if an iCloud account is
/// available — otherwise the app runs on the local store (see `AkashicSyncEngine.activate`).
enum FeatureFlags {
    static let cloudKitEnabled = false

    /// Launch-time seam: `AKASHIC_CLOUDKIT=1` selects `.cloudKit` mode for a single run without
    /// flipping the build flag — the activation path for a simulator signed into iCloud
    /// (launch the `Debug-CloudKit` build with this env set; see README).
    static var cloudKitEnvOverride: Bool {
        ProcessInfo.processInfo.environment["AKASHIC_CLOUDKIT"] == "1"
    }
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

    // MARK: - Data import (T2.4)

    static let importBundlePathKey = "akashic.import.bundlePath"
    static let importMediaRootKey = "akashic.import.mediaRoot"

    /// Default export bundle path. The iOS Simulator can read host filesystem paths
    /// directly, so this works out of the box for the tonight demo.
    static let defaultImportBundlePath = "/Users/cher/Privat/AkashicExport-20260722"

    /// Media root = R2 objects tree inside the export (`<bundle>/r2/objects`).
    static func defaultMediaRoot(forBundlePath bundlePath: String) -> String {
        (bundlePath as NSString).appendingPathComponent("r2/objects")
    }

    static var importBundlePath: String {
        get { UserDefaults.standard.string(forKey: importBundlePathKey) ?? defaultImportBundlePath }
        set { UserDefaults.standard.set(newValue, forKey: importBundlePathKey) }
    }

    static var importMediaRoot: String {
        get {
            UserDefaults.standard.string(forKey: importMediaRootKey)
                ?? defaultMediaRoot(forBundlePath: importBundlePath)
        }
        set { UserDefaults.standard.set(newValue, forKey: importMediaRootKey) }
    }

    static var resolvedPersistenceMode: PersistenceMode {
        // 1. An explicit in-app override (Settings) always wins.
        if let raw = UserDefaults.standard.string(forKey: persistenceModeOverrideKey),
           let mode = PersistenceMode(rawValue: raw) {
            return mode
        }
        // 2. The launch-time env seam selects CloudKit for one run.
        if FeatureFlags.cloudKitEnvOverride { return .cloudKit }
        // 3. Otherwise the build flag.
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
