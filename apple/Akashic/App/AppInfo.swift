import Foundation

/// Consumer-facing app metadata and legal/support links, kept in one place so the Settings
/// screen and (later) the paywall/onboarding never hard-code a URL or a version string.
enum AppInfo {

    // MARK: - External links
    //
    // One constants spot for the public pages. The site is a plain static host
    // (`https://akashic.no/...`); these pages must exist before the consumer build ships.

    static let privacyURL = URL(string: "https://akashic.no/privacy.html")!
    static let termsURL = URL(string: "https://akashic.no/terms.html")!
    static let supportURL = URL(string: "https://akashic.no/support.html")!

    // MARK: - Version

    /// Marketing version, e.g. "0.1.0" (from `CFBundleShortVersionString`).
    static var marketingVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    }

    /// Build number, e.g. "3" (from `CFBundleVersion`).
    static var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
    }

    /// "0.1.0 (3)" — the one-line version shown on the Settings version row (which also doubles
    /// as the hidden developer-tools unlock target; see `DeveloperTools`).
    static var versionDisplay: String {
        "\(marketingVersion) (\(buildNumber))"
    }
}
