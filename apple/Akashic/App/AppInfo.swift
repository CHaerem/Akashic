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

    /// The public showcase page for a published journey.
    ///
    /// `?journey=<slug>` is already the form the web client reads (`useTrekData.parseUrlParams`)
    /// and the form declared in `public/.well-known/apple-app-site-association`, so this one URL
    /// serves both jobs: a page for anyone with the link, and — once the associated-domains
    /// entitlement lands (SHIP-07) — a Universal Link that opens the journey in the app instead.
    ///
    /// **Pass the slug the mirror was published under**, i.e. `PublicMirrorReport.publishedSlug`,
    /// never `journey.slug`. A cross-owner collision publishes to an owner-scoped variant while the
    /// local journey keeps its pretty slug, so building this from the domain object produces a link
    /// that 404s in exactly the case the disambiguation exists for.
    static func showcaseURL(slug: String) -> URL? {
        var components = URLComponents(string: "https://akashic.no/")
        components?.queryItems = [URLQueryItem(name: "journey", value: slug)]
        return components?.url
    }

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

    /// The `User-Agent` sent on Wikipedia/Wikivoyage API requests (see `KnowledgeRetrieval`).
    /// Wikimedia's REST API policy asks clients to identify themselves with an app name, version,
    /// and a contact URL so operators can reach out about traffic — this is that string, e.g.
    /// `"Akashic/0.1.0 (akashic.no; support@akashic.no)"`.
    static var wikimediaUserAgent: String {
        "Akashic/\(marketingVersion) (akashic.no; support@akashic.no)"
    }
}
