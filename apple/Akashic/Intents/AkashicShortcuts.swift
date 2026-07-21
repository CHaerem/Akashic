import AppIntents

/// Natural-language Siri / Spotlight phrases for the journey intents. Every phrase must
/// contain `\(.applicationName)`; parameterised phrases reference `\(\.$journey)` so Siri can
/// prompt for / auto-complete the journey. A few Norwegian variants are included.
struct AkashicShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ListJourneysIntent(),
            phrases: [
                "List my journeys in \(.applicationName)",
                "Show my journeys in \(.applicationName)",
                "List mine reiser i \(.applicationName)"
            ],
            shortTitle: "List Journeys",
            systemImageName: "map"
        )

        AppShortcut(
            intent: SearchJourneysIntent(),
            phrases: [
                "Search journeys in \(.applicationName)",
                "Søk i reiser i \(.applicationName)"
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
