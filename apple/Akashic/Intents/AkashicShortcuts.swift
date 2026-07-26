import AppIntents

/// Natural-language Siri / Spotlight phrases for the journey intents. Every phrase must
/// contain `\(.applicationName)`; parameterised phrases reference `\(\.$journey)` so Siri can
/// prompt for / auto-complete the journey.
///
/// **Every phrase here is English, and that is deliberate.** Two of them used to be
/// hand-written Norwegian mixed into the English list, and both were wrong:
///
///   - `"List mine reiser i \(.applicationName)"` — an English verb with a Norwegian object.
///     "List" is not a Norwegian imperative, and Norwegian would not use the possessive here
///     anyway; the natural phrasing is "Vis reisene mine i Akashic".
///   - `"Søk i reiser i \(.applicationName)"` — grammatical, but "i … i …" twice in five words
///     is something no Norwegian says. "Søk i reisene mine i Akashic" is the natural form.
///
/// Beyond the grammar, a translation sitting in the *source array* is the wrong mechanism: those
/// two phrases were offered to every customer in every language, so an English speaker was shown
/// a Norwegian phrase and a Norwegian speaker still got the English ones. Siri phrases localise
/// through **`AppShortcuts.xcstrings`** specifically — Apple looks for that filename, not
/// `Localizable` — where each phrase below has an `nb` translation, and the system offers only
/// the ones matching the device language. See `Akashic/Resources/AppShortcuts.xcstrings`.
///
/// The catalogue keys use the `${applicationName}` / `${journey}` token spelling rather than
/// Swift's `\(...)`; that is what the build's string extraction emits, and it can be re-checked
/// with `xcodebuild -exportLocalizations`.
struct AkashicShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ListJourneysIntent(),
            phrases: [
                "List my journeys in \(.applicationName)",
                "Show my journeys in \(.applicationName)"
            ],
            shortTitle: "List Journeys",
            systemImageName: "map"
        )

        AppShortcut(
            intent: SearchJourneysIntent(),
            phrases: [
                "Search journeys in \(.applicationName)"
            ],
            shortTitle: "Search Journeys",
            systemImageName: "magnifyingglass"
        )

        AppShortcut(
            intent: GetJourneyDetailsIntent(),
            phrases: [
                "Show journey details for \(\.$journey) in \(.applicationName)",
                "Get details for \(\.$journey) in \(.applicationName)"
            ],
            shortTitle: "Journey Details",
            systemImageName: "mountain.2"
        )

        AppShortcut(
            intent: GetJourneyStatsIntent(),
            phrases: [
                "Show stats for \(\.$journey) in \(.applicationName)",
                "Get \(\.$journey) statistics in \(.applicationName)"
            ],
            shortTitle: "Journey Stats",
            systemImageName: "chart.bar"
        )

        AppShortcut(
            intent: GetJourneyPhotosIntent(),
            phrases: [
                "Show photos for \(\.$journey) in \(.applicationName)",
                "Get \(\.$journey) photos in \(.applicationName)"
            ],
            shortTitle: "Journey Photos",
            systemImageName: "photo"
        )
    }
}
