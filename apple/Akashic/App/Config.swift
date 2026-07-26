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

/// Static build-time feature flags.
///
/// `cloudKitEnabled` is derived from the compile-time `AKASHIC_CLOUDKIT_BUILD` flag, which the
/// `Debug-CloudKit` / `Release-CloudKit` configurations define. That is the ONLY build that can
/// construct a CloudKit container, so it is exactly the build that should default to `.cloudKit`
/// mode. The default Debug/Release build (no flag) has no entitlement and defaults to `.fixtures`.
///
/// This closes the fresh-install trap: before, `cloudKitEnabled` was a hard `false`, so EVERY
/// build — including the entitled TestFlight binary — resolved `.fixtures` and seeded demo
/// journeys unless `AKASHIC_CLOUDKIT=1` was set by hand. A customer's fresh install landed in demo
/// mode. Now the CloudKit build defaults to sync; the env var + Settings override remain, as
/// overrides rather than the only lifeline. (quality gate: fresh installs run fixtures.)
///
/// Even when true, the sync engine only *starts* if an iCloud account is available — otherwise the
/// app runs on the local store (see `AkashicSyncEngine.activate`).
enum FeatureFlags {
    static var cloudKitEnabled: Bool {
        #if AKASHIC_CLOUDKIT_BUILD
        return true
        #else
        return false
        #endif
    }

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

    /// `AKASHIC_EMPTY=1` — start with no journeys at all, in any persistence mode.
    ///
    /// This is the state every new customer is in on first launch, and without this flag it could
    /// only be reached with a signed CloudKit build signed into an empty iCloud account. Used for
    /// inspecting the empty states and for the App Store screenshot of a fresh install.
    static var startEmpty: Bool {
        ProcessInfo.processInfo.environment["AKASHIC_EMPTY"] == "1"
    }

    // MARK: - Data import (T2.5)

    static let importBundlePathKey = "akashic.import.bundlePath"
    static let importMediaRootKey = "akashic.import.mediaRoot"

    /// Default export bundle path for the one-time migration importer.
    ///
    /// Empty in Release: this is a developer convenience for the T2.5 import, and the literal path
    /// it used to carry was a specific person's home directory compiled into a commercial binary
    /// (LEG-08). The importer is developer-only and reachable only from the gated developer
    /// section, so a Release build has no legitimate default to offer — the folder picker supplies
    /// the path. Debug keeps the convenience, and the DEBUG value can be overridden per machine
    /// with the AKASHIC_IMPORT_BUNDLE environment variable so it is not hardcoded to one checkout
    /// either.
    /// Set `AKASHIC_IMPORT_BUNDLE` in the scheme to pre-fill it; otherwise the developer screen's
    /// folder picker supplies the path. Deliberately not derived from `NSHomeDirectory()`: in the
    /// Simulator that resolves to the app's sandbox container, not the host home directory the
    /// export actually lives in, so guessing would produce a path that never exists.
    static var defaultImportBundlePath: String {
        #if DEBUG
        ProcessInfo.processInfo.environment["AKASHIC_IMPORT_BUNDLE"] ?? ""
        #else
        ""
        #endif
    }

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
        let override = UserDefaults.standard.string(forKey: persistenceModeOverrideKey)
            .flatMap(PersistenceMode.init(rawValue:))
        return resolvePersistenceMode(override: override,
                                      envCloudKit: FeatureFlags.cloudKitEnvOverride,
                                      cloudKitBuild: FeatureFlags.cloudKitEnabled)
    }

    /// Pure resolver — the whole persistence-mode decision as data, so every branch is unit-tested
    /// per build flag without touching UserDefaults or the process environment.
    ///
    /// Precedence: an explicit Settings override always wins; then the launch-time `AKASHIC_CLOUDKIT`
    /// env seam; then the build flag — a CloudKit-entitled build defaults to `.cloudKit`, everything
    /// else to `.fixtures`. (quality gate: fresh installs run fixtures.)
    static func resolvePersistenceMode(override: PersistenceMode?,
                                       envCloudKit: Bool,
                                       cloudKitBuild: Bool) -> PersistenceMode {
        if let override { return override }
        if envCloudKit { return .cloudKit }
        return cloudKitBuild ? .cloudKit : .fixtures
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
