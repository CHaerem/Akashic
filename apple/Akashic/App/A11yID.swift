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

    /// DIFF-15: the one-occasion "download over cellular anyway" action on the waiting-to-download
    /// surface. A label query cannot address it — the same sentence is a Settings row doing the same
    /// job, so "the button reading 'Download now over cellular'" is ambiguous across screens.
    static let journeyListDownloadNow = "journeyList.downloadNow"

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

    // MARK: Map markers (QUA-90)

    /// Camp badges and photo stacks on the trek map.
    ///
    /// These two break the "one identifier per control" habit above on purpose, and the reason is
    /// what makes QUA-90's test possible. The defect being guarded is *geometric* — a photo stack
    /// covering a camp badge and eating its tap — so the test does not want "the badge for day 6",
    /// it wants "the badge that has a stack on top of it". It therefore enumerates every marker by
    /// identifier PREFIX and picks by frame overlap. A unique identifier per camp would not help:
    /// Kilimanjaro has two camps numbered day 6 (Uhuru Peak and Mweka Camp, 9 km apart), so day
    /// number is not unique anyway.
    ///
    /// Both are also applied INSIDE `CampBadge` / `PhotoMarker` rather than at their call sites in
    /// `GlobeExperienceView`, which is load-bearing for the proof: `npm run prove` reverts whole
    /// FILES, so an identifier passed in from the call site would vanish along with the declaration
    /// order the revert is meant to restore, and the resulting red would be "element not found"
    /// instead of "the photo stole the tap". A red for the wrong reason proves nothing.
    static let mapCampBadgePrefix = "map.campBadge."
    static let mapPhotoStackPrefix = "map.photoStack."

    static func mapCampBadge(day: Int) -> String { "\(mapCampBadgePrefix)day\(day)" }
    static func mapPhotoStack(photoID: String) -> String { "\(mapPhotoStackPrefix)\(photoID)" }
}
