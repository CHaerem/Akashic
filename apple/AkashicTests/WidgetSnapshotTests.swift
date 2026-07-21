import XCTest
@testable import Akashic

/// Tests the separable, pure parts of the widget data path: building a `WidgetSnapshot` from a
/// `Journey`, elevation downsampling, the precomputed display strings, and a `WidgetDataStore`
/// JSON round-trip against a temp directory (the App-Group container is unavailable in tests).
final class WidgetSnapshotTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func kilimanjaro() throws -> Journey {
        try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
    }

    // MARK: - Snapshot building

    func testSnapshotFromJourneyPrecomputesDisplayFields() throws {
        let journey = try kilimanjaro()
        let snapshot = WidgetSnapshot.make(from: journey)

        XCTAssertEqual(snapshot.id, journey.id)
        XCTAssertEqual(snapshot.name, "Kilimanjaro")
        XCTAssertEqual(snapshot.country, "Tanzania")
        XCTAssertEqual(snapshot.flag, "🇹🇿")
        XCTAssertEqual(snapshot.days, 7)
        XCTAssertEqual(snapshot.daysText, "7 days")
        XCTAssertEqual(snapshot.distanceText, "70 km")
        XCTAssertEqual(snapshot.summitElevation, 5895)
        XCTAssertEqual(snapshot.summitText, "5,895 m")
        // Route carries elevation, so the sparkline series is populated and capped.
        XCTAssertFalse(snapshot.elevationSamples.isEmpty)
        XCTAssertLessThanOrEqual(snapshot.elevationSamples.count, 48)
        XCTAssertNil(snapshot.thumbnailPath)
    }

    // MARK: - Elevation sampling

    func testSampleElevationsDownsamplesToCap() {
        let coords: [[Double]] = (0..<500).map { [Double($0), 0, Double($0)] }
        let samples = WidgetSnapshot.sampleElevations(coords, count: 48)
        XCTAssertEqual(samples.count, 48)
        XCTAssertEqual(samples.first, 0)
        XCTAssertEqual(samples.last, 499)
    }

    func testSampleElevationsKeepsShortSeriesAndDropsMissingElevation() {
        let short: [[Double]] = [[0, 0, 100], [1, 1, 200], [2, 2, 150]]
        XCTAssertEqual(WidgetSnapshot.sampleElevations(short, count: 48), [100, 200, 150])

        // Coordinates without a 3rd (elevation) component yield no samples.
        let flat: [[Double]] = [[0, 0], [1, 1]]
        XCTAssertEqual(WidgetSnapshot.sampleElevations(flat, count: 48), [])
    }

    // MARK: - Formatting helpers

    func testKilometresTextDropsTrailingZero() {
        XCTAssertEqual(WidgetSnapshot.kilometresText(70), "70 km")
        XCTAssertEqual(WidgetSnapshot.kilometresText(12.45), "12.5 km")
        XCTAssertEqual(WidgetSnapshot.kilometresText(0), "0 km")
    }

    func testGroupedThousands() {
        XCTAssertEqual(WidgetSnapshot.groupedThousands(5895), "5,895")
        XCTAssertEqual(WidgetSnapshot.groupedThousands(999), "999")
        XCTAssertEqual(WidgetSnapshot.groupedThousands(1_000_000), "1,000,000")
        XCTAssertEqual(WidgetSnapshot.groupedThousands(0), "0")
    }

    // MARK: - Data store round-trip

    func testDataStoreWritesAndReadsSnapshots() throws {
        let tempDir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let store = WidgetDataStore(directory: tempDir)
        let journeys = try FixtureLoader.loadAll(bundle: bundle)
        let snapshots = journeys.map { WidgetSnapshot.make(from: $0) }

        XCTAssertTrue(store.write(snapshots))
        let loaded = store.load()
        XCTAssertEqual(loaded, snapshots)   // order + all fields preserved
        XCTAssertEqual(loaded.count, 3)
    }

    func testDataStoreWithoutContainerIsNoOp() {
        // No directory → mimics the unsigned build with no App Group: write no-ops, load empty.
        let store = WidgetDataStore(directory: nil)
        XCTAssertFalse(store.write([WidgetPlaceholder.snapshot]))
        XCTAssertEqual(store.load(), [])
    }

    // MARK: - Publisher

    func testPublisherWritesThroughToStore() throws {
        let tempDir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let store = WidgetDataStore(directory: tempDir)
        let journeys = try FixtureLoader.loadAll(bundle: bundle)
        WidgetPublisher.publish(journeys, store: store)

        XCTAssertEqual(store.load().count, journeys.count)
    }
}
