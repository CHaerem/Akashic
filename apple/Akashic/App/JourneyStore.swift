import Foundation
import Combine

/// Observable source of journeys for the UI. Reads through the Core Data layer so the
/// SwiftUI views exercise the same mapping path CloudKit will use.
@MainActor
final class JourneyStore: ObservableObject {
    @Published private(set) var journeys: [Journey] = []
    @Published private(set) var loadError: String?

    private let persistence: PersistenceController

    init(persistence: PersistenceController = .shared) {
        self.persistence = persistence
        reload()
    }

    var mode: PersistenceMode { persistence.mode }

    func reload() {
        journeys = persistence.loadJourneys()
        loadError = journeys.isEmpty ? "No journeys found in the \(persistence.mode.label) store." : nil
    }

    func journey(withID id: String) -> Journey? {
        journeys.first { $0.id == id }
    }
}
