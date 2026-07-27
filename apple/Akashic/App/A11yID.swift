import Foundation

/// Accessibility identifiers for the handful of controls `AkashicUITests` drives (QUA-10 / QUA-29).
///
/// ## Why identifiers and not the visible labels
///
/// A UI test that stops finding its element does not fail — it silently taps nothing and passes,
/// which is strictly worse than having no test. Everything visible on these screens is a
/// `LocalizedStringKey` resolved through `Localizable.xcstrings`, so a label-based query would
/// break on any copy edit and on every non-English run (the suite pins `-AppleLanguages "(en)"`
/// for the same reason, but pinning the language does not survive a reworded button). An
/// identifier is a contract between the view and the test, and nothing else reads it.
///
/// ## Why this is safe to add to shipping views
///
/// `accessibilityIdentifier` is invisible to VoiceOver (it is not the label, value, or hint) and
/// never enters the string catalogue — it is a `String`, deliberately, and that is the one place
/// in this codebase where `String` rather than `LocalizedStringKey` is correct.
///
/// ## The rule for adding one
///
/// Only for a control a test must find, and only where the test would otherwise have to guess.
/// This is not a place to enumerate the UI: SwiftUI composes a `Button` wrapping two `Text`s into
/// one element whose label is the two strings concatenated, so the cases below are exactly the
/// controls where a label query is ambiguous or unstable, and no more.
enum A11yID {

    // MARK: Globe (the landing screen)

    /// The empty-globe call to action — the front door for a brand-new customer.
    static let globeCreateFirstJourney = "globe.createFirstJourney"

    // MARK: New journey (the 1,188-line sheet)

    /// Phase 1 chooser: "what do you have?" Three cards, each a `Button` around a title AND a
    /// subtitle, so each one's accessibility label is the two sentences joined.
    static let chooserPhotos = "newJourney.chooser.photos"
    static let chooserGPX = "newJourney.chooser.gpx"
    static let chooserNameOnly = "newJourney.chooser.nameOnly"

    /// Phase 2 review screen.
    static let newJourneyName = "newJourney.name"
    static let newJourneyAddDay = "newJourney.addDay"

    /// `EditSheetScaffold`'s two toolbar buttons. Shared by every edit sheet in the app, which is
    /// the point: one identifier pair for "the affirmative action of the sheet I am looking at".
    static let editSheetSave = "editSheet.save"
    static let editSheetCancel = "editSheet.cancel"

    // MARK: Journeys list

    static let journeyListCreate = "journeyList.create"

    // MARK: Paywall (the money path)

    static let paywallHeadline = "paywall.headline"
    /// The one control in the app that spends money.
    static let paywallPurchase = "paywall.purchase"
    static let paywallRestore = "paywall.restore"
    /// Shown INSTEAD of `paywallPurchase` to someone who already owns Complete — a live buy button
    /// for something already owned is a wrong-state purchase surface and a reviewer red flag, so a
    /// test asserts the two are mutually exclusive.
    static let paywallAlreadyComplete = "paywall.alreadyComplete"
    /// The product-unavailable / offline row. Its presence proves the sheet degraded rather than
    /// bricked; the retry inside it is `paywallRetry`.
    static let paywallUnavailable = "paywall.unavailable"
    static let paywallRetry = "paywall.retry"
    static let paywallClose = "paywall.close"

    // MARK: Settings

    /// The "Akashic Complete" row — the paywall's `.settings` entry point, and the only one
    /// reachable without first filling the free tier.
    static let settingsComplete = "settings.akashicComplete"
}
