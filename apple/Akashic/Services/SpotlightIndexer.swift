import Foundation
import CoreSpotlight
import UniformTypeIdentifiers

/// Indexes journeys (and their days/camps) into Spotlight so they are searchable from the
/// system, and decodes taps on those results back into a journey selection.
///
/// Unlike the widget path, Spotlight needs **no** entitlement or App Group — `CSSearchableIndex`
/// works on the unsigned simulator build, so this is fully functional tonight.
///
/// The pure, testable parts (building `CSSearchableItem`s, parsing an item identifier back to a
/// journey id) are separated from the side-effecting index/deindex calls.
struct SpotlightIndexer {
    static let shared = SpotlightIndexer()

    /// All Akashic items share this domain so a single call can clear + rebuild the index.
    static let domainIdentifier = "no.akashic.journeys"

    // MARK: - Item identifiers (pure)

    static func itemIdentifier(journeyID: String) -> String {
        "journey/\(journeyID)"
    }

    static func itemIdentifier(journeyID: String, dayNumber: Int) -> String {
        "journey/\(journeyID)/day/\(dayNumber)"
    }

    /// Extract the journey id from any Akashic item identifier (journey OR day form).
    static func journeyID(fromItemIdentifier identifier: String) -> String? {
        let parts = identifier.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count >= 2, parts[0] == "journey" else { return nil }
        return parts[1]
    }

    /// The journey id carried by a tapped Spotlight `NSUserActivity`, if it is one of ours.
    static func journeySelection(from activity: NSUserActivity) -> String? {
        guard activity.activityType == CSSearchableItemActionType,
              let identifier = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String
        else { return nil }
        return journeyID(fromItemIdentifier: identifier)
    }

    // MARK: - Item building (pure)

    /// One searchable item per journey plus one per day/camp.
    func searchableItems(for journeys: [Journey]) -> [CSSearchableItem] {
        journeys.flatMap { journey -> [CSSearchableItem] in
            [Self.journeyItem(journey)] + journey.camps.map { Self.dayItem(journey: journey, camp: $0) }
        }
    }

    static func journeyItem(_ journey: Journey) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: .content)
        attributes.title = journey.shortName
        attributes.contentDescription = journeyDescription(journey)
        attributes.keywords = journeyKeywords(journey)
        return CSSearchableItem(
            uniqueIdentifier: itemIdentifier(journeyID: journey.id),
            domainIdentifier: domainIdentifier,
            attributeSet: attributes)
    }

    static func dayItem(journey: Journey, camp: Camp) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: .content)
        attributes.title = "Day \(camp.dayNumber): \(camp.name)"
        attributes.contentDescription = dayDescription(journey: journey, camp: camp)
        attributes.keywords = [journey.shortName, journey.country, camp.name] + camp.highlights
        return CSSearchableItem(
            uniqueIdentifier: itemIdentifier(journeyID: journey.id, dayNumber: camp.dayNumber),
            domainIdentifier: domainIdentifier,
            attributeSet: attributes)
    }

    static func journeyDescription(_ journey: Journey) -> String {
        var parts: [String] = []
        if !journey.country.isEmpty { parts.append(journey.country) }
        let days = journey.totalDays ?? journey.stats.duration
        parts.append("\(days) day\(days == 1 ? "" : "s")")
        let distance = journey.totalDistance ?? journey.stats.totalDistance
        if distance > 0 { parts.append(WidgetSnapshot.kilometresText(distance)) }
        if let summit = journey.summitElevation ?? journey.stats.highestPoint?.elevation {
            parts.append("summit \(WidgetSnapshot.groupedThousands(summit)) m")
        }
        return parts.joined(separator: " · ")
    }

    static func dayDescription(journey: Journey, camp: Camp) -> String {
        var parts = ["\(journey.shortName)"]
        parts.append("\(WidgetSnapshot.groupedThousands(camp.elevation)) m")
        if camp.dayDistance > 0 {
            parts.append(WidgetSnapshot.kilometresText(camp.dayDistance))
        }
        return parts.joined(separator: " · ")
    }

    static func journeyKeywords(_ journey: Journey) -> [String] {
        var keywords = [journey.shortName, journey.name, journey.country]
        keywords.append(contentsOf: journey.camps.map(\.name))
        if let summitName = journey.stats.highestPoint?.name { keywords.append(summitName) }
        // De-duplicate while preserving order, dropping empties.
        var seen = Set<String>()
        return keywords.filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    // MARK: - Indexing (side-effecting, idempotent)

    /// Whether the process should actually touch the Spotlight index. Skipped under XCTest so
    /// the unit suite stays offline and side-effect free.
    static var indexingEnabled: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil
    }

    /// Clear the Akashic domain and re-index the given journeys. Idempotent: safe to call on
    /// every store load / import.
    func reindex(_ journeys: [Journey], index: CSSearchableIndex = .default()) {
        guard Self.indexingEnabled else { return }
        let items = searchableItems(for: journeys)
        index.deleteSearchableItems(withDomainIdentifiers: [Self.domainIdentifier]) { _ in
            guard !items.isEmpty else { return }
            index.indexSearchableItems(items) { _ in }
        }
    }
}
