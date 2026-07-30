import XCTest
@testable import Akashic

/// QUA-95: does a journey agree with its own photographs?
///
/// Every case here is shaped from a defect measured on the owner's real archive rather than invented,
/// and each has a mirror in `scripts/export/smoke.ts` so the Swift and TypeScript rule sets cannot
/// drift silently. The cases that must stay SILENT matter as much as the ones that fire: a check that
/// cries wolf on an ordinary journey gets ignored, and then it protects nothing.
final class JourneyCoherenceTests: XCTestCase {

    // MARK: Builders

    private func camp(_ id: String, day: Int, coords: [Double] = [10, 60]) -> Camp {
        Camp(id: id, name: "Camp \(day)", dayNumber: day, elevation: 0,
             coordinates: coords, notes: "", highlights: [])
    }

    private func journey(camps: [Camp], started: String?, ended: String?) -> Journey {
        Journey(id: "J", slug: "j", name: "J", country: "", description: "",
                heroImageURL: nil, dateStarted: started, dateEnded: ended,
                isPublic: false, summitElevation: nil, totalDistance: nil, totalDays: nil,
                centerCoordinates: nil, preferredBearing: nil, preferredPitch: nil,
                stats: TrekStats(duration: 0, totalDistance: 0, totalElevationGain: 0,
                                 totalElevationLoss: nil, highestPoint: nil),
                route: Route(type: "LineString", coordinates: []),
                camps: camps)
    }

    private func photo(_ id: String, day waypoint: String? = "W1", takenAt: String?,
                       coords: [Double]? = nil, source: String? = "exif") -> Photo {
        Photo(id: id, journeyId: "J", waypointId: waypoint, url: "u", thumbnailURL: nil,
              caption: nil, coordinates: coords, takenAt: takenAt, isHero: false,
              sortOrder: 0, rotation: 0, mediaType: "image", duration: nil,
              locationSource: source, localOriginalPath: nil)
    }

    /// A coherent journey: dates contain the photos, every photo has a day and a distinct EXIF
    /// position, no duplicated day numbers.
    private func cleanSetup(_ n: Int = 30) -> (Journey, [Photo]) {
        let j = journey(camps: [camp("W1", day: 1), camp("W2", day: 2)],
                        started: "2017-09-29", ended: "2017-10-06")
        let photos = (0..<n).map { i in
            photo("p\(i)", takenAt: "2017-10-0\((i % 6) + 1)T09:00:00Z",
                  coords: [-72.54 + Double(i) * 0.001, -13.18])
        }
        return (j, photos)
    }

    // MARK: Silence

    func testCoherentJourneyProducesNoFindings() {
        let (j, photos) = cleanSetup()
        XCTAssertEqual(JourneyCoherence.findings(journey: j, photos: photos), [])
    }

    func testAJourneyWithNoPhotosIsNotAudited() {
        let (j, _) = cleanSetup()
        XCTAssertEqual(JourneyCoherence.findings(journey: j, photos: []), [])
    }

    func testTheLastAfternoonAndADayOfSlackAreAllowed() {
        var (j, photos) = cleanSetup(4)
        // `dateEnded` parses to midnight at the START of that day, so 14:00 on the last recorded day
        // would read as "after the trip" without the end-of-day handling. That would have flagged
        // every journey's final afternoon.
        photos[0] = photo("p0", takenAt: "2017-10-06T14:00:00Z", coords: [-72.5, -13.1])
        photos[1] = photo("p1", takenAt: "2017-09-28T20:00:00Z", coords: [-72.6, -13.2])
        photos[2] = photo("p2", takenAt: "2017-10-07T06:00:00Z", coords: [-72.7, -13.3])
        j = journey(camps: [camp("W1", day: 1)], started: "2017-09-29", ended: "2017-10-06")
        let dateFindings = JourneyCoherence.findings(journey: j, photos: photos)
            .filter { if case .datesExcludePhotos = $0 { return true } else { return false } }
        XCTAssertEqual(dateFindings, [])
    }

    func testAFewPhotosAtOneCampIsOrdinary() {
        // The same coordinate on a handful of photos is what standing at a camp looks like.
        let (j, _) = cleanSetup()
        let photos = (0..<8).map { photo("p\($0)", takenAt: "2017-10-01T09:00:00Z", coords: [-72.54, -13.18]) }
        let collapsed = JourneyCoherence.findings(journey: j, photos: photos)
            .filter { if case .collapsedCoordinate = $0 { return true } else { return false } }
        XCTAssertEqual(collapsed, [])
    }

    func testAJourneyWithNoCoordinatesAtAllIsAnHonestState() {
        let (j, _) = cleanSetup()
        let photos = (0..<10).map { photo("p\($0)", takenAt: "2017-10-01T09:00:00Z", coords: nil, source: nil) }
        let located = JourneyCoherence.findings(journey: j, photos: photos)
            .filter { if case .noRealLocation = $0 { return true } else { return false } }
        XCTAssertEqual(located, [], "no coordinates is different from every coordinate being a guess")
    }

    // MARK: The real defects

    func testImplausibleSpanIsFlagged() {
        // Kilimanjaro's row read 2022-09-30 to 2023-10-09 — 374 days.
        let j = journey(camps: [camp("W1", day: 1)], started: "2022-09-30", ended: "2023-10-09")
        let photos = [photo("p", takenAt: "2022-10-01T09:00:00Z", coords: [37.3, -3.0])]
        XCTAssertTrue(JourneyCoherence.findings(journey: j, photos: photos)
            .contains(.implausibleSpan(days: 374)))
    }

    func testPhotosOutsideTheRecordedDatesAreFlagged() {
        // Mount Kenya: recorded 2023, photographed 2024 — day and month matched exactly.
        let j = journey(camps: [camp("W1", day: 1)], started: "2023-10-10", ended: "2023-10-17")
        let photos = (0..<6).map { photo("p\($0)", takenAt: "2024-10-1\($0)T09:00:00Z", coords: [37.3, -0.15]) }
        let finding = JourneyCoherence.findings(journey: j, photos: photos).first {
            if case .datesExcludePhotos = $0 { return true } else { return false }
        }
        guard case let .datesExcludePhotos(outside, total, first, last)? = finding else {
            return XCTFail("expected datesExcludePhotos, got \(String(describing: finding))")
        }
        XCTAssertEqual(outside, 6)
        XCTAssertEqual(total, 6)
        XCTAssertEqual(first, "2024-10-10")
        XCTAssertEqual(last, "2024-10-15")
    }

    func testDuplicateDayNumbersAreFlagged() {
        // Kilimanjaro numbers Uhuru Peak and Mweka Camp both day 6.
        let j = journey(camps: [camp("W1", day: 1), camp("W2", day: 6), camp("W3", day: 6)],
                        started: "2022-10-01", ended: "2022-10-08")
        let photos = [photo("p", takenAt: "2022-10-02T09:00:00Z", coords: [37.3, -3.0])]
        XCTAssertTrue(JourneyCoherence.findings(journey: j, photos: photos)
            .contains(.duplicateDayNumbers([6])))
    }

    func testAJourneyWithNoDayAssignmentIsFlagged() {
        // All 939 Kilimanjaro photos had an empty waypoint reference.
        let (j, photos) = cleanSetup(12)
        let unassigned = photos.map { p -> Photo in var q = p; q.waypointId = nil; return q }
        XCTAssertTrue(JourneyCoherence.findings(journey: j, photos: unassigned)
            .contains(.noDayAssignment(photos: 12)))
    }

    func testACollapsedCoordinateIsFlagged() {
        // 144 of Mount Kenya's photos shared one estimate, 265 km off its route.
        let (j, _) = cleanSetup()
        let photos = (0..<40).map { i in
            photo("p\(i)", takenAt: "2017-10-01T09:00:00Z",
                  coords: i < 30 ? [35.26, -1.37] : [-72.54 + Double(i) * 0.001, -13.18],
                  source: i < 30 ? "estimated" : "exif")
        }
        let finding = JourneyCoherence.findings(journey: j, photos: photos).first {
            if case .collapsedCoordinate = $0 { return true } else { return false }
        }
        guard case let .collapsedCoordinate(count, located, lat, lon)? = finding else {
            return XCTFail("expected collapsedCoordinate")
        }
        XCTAssertEqual(count, 30)
        XCTAssertEqual(located, 40)
        XCTAssertEqual(lat, -1.37)
        XCTAssertEqual(lon, 35.26)
    }

    func testAJourneyWhereNothingCameFromTheCameraIsFlagged() {
        let (j, _) = cleanSetup()
        let photos = (0..<25).map { i in
            photo("p\(i)", takenAt: "2017-10-01T09:00:00Z",
                  coords: [37.3 + Double(i) * 0.01, -0.15], source: "estimated")
        }
        XCTAssertTrue(JourneyCoherence.findings(journey: j, photos: photos)
            .contains(.noRealLocation(located: 25)))
    }

    // MARK: Thresholds agree with the export tooling

    func testThresholdsMatchTheTypeScriptImplementation() {
        // If these move, `auditJourneyCoherence` in scripts/export/lib.ts must move with them, or the
        // export gate and the app will quietly disagree about the same journey.
        XCTAssertEqual(JourneyCoherence.maxSpanDays, 90)
        XCTAssertEqual(JourneyCoherence.collapsedShare, 0.25)
        XCTAssertEqual(JourneyCoherence.collapsedMinimum, 20)
    }
}
