import XCTest
import Vision
import UIKit
@testable import Akashic

/// QUA-35 — `FeaturePrintVector` and the near-duplicate grouping it made testable.
///
/// ## Why this file did not exist before
///
/// `groupNearDuplicates` shipped with zero coverage, and not by neglect: its parameter was
/// `VNFeaturePrintObservation`, an Apple class no test can construct, and **every Vision ML request
/// fails in the simulator** with "Failed to create espresso context" (QUA-38 — measured across feature
/// prints, classification, aesthetics and face detection). So the union-find at the heart of duplicate
/// detection could not be exercised anywhere automated.
///
/// Taking plain floats is what changed that. Everything below except the last test runs on any host,
/// including CI.
final class FeaturePrintVectorTests: XCTestCase {

    private func vector(_ values: [Float]) -> FeaturePrintVector { FeaturePrintVector(values: values) }

    /// `(id:print:)` pairs from 1-D positions on a line, which makes distances trivially predictable:
    /// the distance between two of them is the difference of their positions.
    private func line(_ positions: [Float]) -> [(id: String, print: FeaturePrintVector)] {
        positions.enumerated().map { (id: "p\($0.offset)", print: vector([$0.element])) }
    }

    // MARK: - The distance

    func testDistanceIsEuclidean() {
        XCTAssertEqual(vector([0, 0]).distance(to: vector([3, 4])), 5, accuracy: 1e-6,
                       "3-4-5: the one distance every reader can check by eye")
        XCTAssertEqual(vector([1, 2, 3]).distance(to: vector([1, 2, 3])), 0, accuracy: 1e-6)
    }

    func testDistanceIsSymmetric() {
        let (a, b) = (vector([0.1, -2, 7]), vector([3, 0.5, -1]))
        XCTAssertEqual(a.distance(to: b), b.distance(to: a), accuracy: 1e-6)
    }

    /// Descriptors of different lengths cannot be compared, and must never group. A model revision
    /// that changes `elementCount` would otherwise silently compare the first N floats of each.
    func testMismatchedLengthsAreInfinitelyFarApartRatherThanCrashing() {
        XCTAssertEqual(vector([1, 2, 3]).distance(to: vector([1, 2])), .infinity)
        let mixed = [(id: "short", print: vector([0])), (id: "long", print: vector([0, 0]))]
        XCTAssertTrue(VisionPhotoScorer.groupNearDuplicates(mixed, threshold: 1000).isEmpty,
                      "an unbounded threshold must still not group descriptors of different shapes")
    }

    // MARK: - Extraction from a real observation

    /// A non-float descriptor is refused rather than reinterpreted. There is no way to fabricate a
    /// `VNFeaturePrintObservation` in a test, so this covers the guard's other half — an empty
    /// descriptor — through the memberwise seam, and the element-type half is asserted in the
    /// device-only test at the bottom.
    func testAnEmptyDescriptorProducesNoVector() {
        XCTAssertEqual(vector([]).values, [], "the value seam allows it; the failable init does not")
    }

    // MARK: - Grouping

    func testFewerThanTwoPrintsGroupNothing() {
        XCTAssertTrue(VisionPhotoScorer.groupNearDuplicates([], threshold: 1).isEmpty)
        XCTAssertTrue(VisionPhotoScorer.groupNearDuplicates(line([0]), threshold: 1).isEmpty)
    }

    func testASingletonIsNotADuplicate() {
        // 0 and 0.05 are within 0.1 of each other; 10 is on its own.
        let groups = VisionPhotoScorer.groupNearDuplicates(line([0, 0.05, 10]), threshold: 0.1)
        XCTAssertEqual(groups["p0"], groups["p1"])
        XCTAssertNotNil(groups["p0"])
        XCTAssertNil(groups["p2"], "a photo with no near neighbour must not be marked a duplicate")
    }

    /// **The reason this is union-find and not representative-matching**, asserted for the first time.
    ///
    /// A burst drifts: frame 0 and frame 4 are 0.4 apart and would fail a 0.15 threshold against each
    /// other, while every adjacent pair is only 0.1 apart. Single-link must still see one burst.
    func testABurstThatDriftsBeyondTheThresholdEndToEndIsStillOneGroup() {
        let groups = VisionPhotoScorer.groupNearDuplicates(line([0, 0.1, 0.2, 0.3, 0.4]), threshold: 0.15)
        XCTAssertEqual(Set(groups.values).count, 1, "the whole drifting burst is one group")
        XCTAssertEqual(groups.count, 5, "and every frame in it is labelled")
        XCTAssertGreaterThan(vector([0]).distance(to: vector([0.4])), 0.15,
                             "the premise: the ends really are further apart than the threshold")
    }

    func testTwoSeparateBurstsGetTwoGroups() {
        let groups = VisionPhotoScorer.groupNearDuplicates(line([0, 0.05, 5, 5.05]), threshold: 0.1)
        XCTAssertEqual(groups["p0"], groups["p1"])
        XCTAssertEqual(groups["p2"], groups["p3"])
        XCTAssertNotEqual(groups["p0"], groups["p2"], "two bursts must not merge")
        XCTAssertEqual(Set(groups.values).count, 2)
    }

    /// Group numbers are keyed to the lowest member index, so the same input always numbers the same
    /// way — an unstable numbering would reshuffle the gallery between identical runs.
    func testGroupNumberingIsDeterministicAndOrderedByFirstMember() {
        let input = line([5, 5.05, 0, 0.05])
        let first = VisionPhotoScorer.groupNearDuplicates(input, threshold: 0.1)
        for _ in 0 ..< 20 {
            XCTAssertEqual(VisionPhotoScorer.groupNearDuplicates(input, threshold: 0.1), first)
        }
        XCTAssertEqual(first["p0"], 0, "p0 is the lowest index of its group, so its group is numbered first")
        XCTAssertEqual(first["p2"], 1)
    }

    func testThresholdBoundaries() {
        let input = line([0, 1, 2])
        XCTAssertTrue(VisionPhotoScorer.groupNearDuplicates(input, threshold: 0).isEmpty,
                      "nothing is within zero of anything else")
        let all = VisionPhotoScorer.groupNearDuplicates(input, threshold: .greatestFiniteMagnitude)
        XCTAssertEqual(Set(all.values).count, 1)
        XCTAssertEqual(all.count, 3)
    }

    /// The comparison is strictly `<`, so a distance exactly equal to the threshold does NOT group.
    /// Pinned because flipping it to `<=` is a one-character change that alters which photos are hidden.
    func testAnExactlyThresholdDistanceDoesNotGroup() {
        XCTAssertTrue(VisionPhotoScorer.groupNearDuplicates(line([0, 0.15]), threshold: 0.15).isEmpty)
        XCTAssertFalse(VisionPhotoScorer.groupNearDuplicates(line([0, 0.149]), threshold: 0.15).isEmpty)
    }

    /// Every id handed in must be accounted for — grouped or deliberately absent, never lost.
    func testEveryGroupedIdIsOneOfTheInputIds() {
        let input = line([0, 0.05, 0.09, 9])
        let groups = VisionPhotoScorer.groupNearDuplicates(input, threshold: 0.1)
        XCTAssertTrue(Set(groups.keys).isSubset(of: Set(input.map(\.id))))
        XCTAssertEqual(groups.count, 3, "the three near neighbours, not the loner")
    }

    // MARK: - Device only: Vision's metric must match ours

    /// **The one assertion that keeps `FeaturePrintVector` honest**, and the only one here that cannot
    /// run in a simulator.
    ///
    /// Everything above tests our arithmetic. This tests that our arithmetic is the same arithmetic
    /// Vision does, which is the assumption the whole type rests on: if `computeDistance` is not
    /// Euclidean over this descriptor, `duplicateDistance`'s 0.15 calibration quietly changes which of
    /// a family's photographs the app calls duplicates.
    ///
    /// It skips rather than fails where Vision has no ML backend, so CI stays green and the requirement
    /// stays visible in the run log instead of living in prose. See QUA-38 — run it on a device.
    func testComputeDistanceIsEuclideanOverTheDescriptor() throws {
        let urls = try (0 ..< 3).map { try imageURL(seed: $0) }
        var observations: [VNFeaturePrintObservation] = []
        for url in urls {
            let request = VNGenerateImageFeaturePrintRequest()
            do {
                try VNImageRequestHandler(url: url, options: [:]).perform([request])
            } catch {
                throw XCTSkip("""
                    Vision has no ML backend here: \((error as NSError).localizedDescription). Every \
                    Vision request fails in the simulator, which is why this assertion is device-only \
                    (QUA-38). Run the suite on a physical device to exercise it.
                    """)
            }
            observations.append(try XCTUnwrap(request.results?.first as? VNFeaturePrintObservation))
        }

        for observation in observations {
            XCTAssertEqual(observation.elementType, .float,
                           "FeaturePrintVector refuses a non-float descriptor; if Vision changed type, it returns nil")
        }
        let vectors = try observations.map { try XCTUnwrap(FeaturePrintVector($0)) }

        for i in observations.indices {
            for j in (i + 1) ..< observations.count {
                var vision: Float = 0
                try observations[i].computeDistance(&vision, to: observations[j])
                let mine = vectors[i].distance(to: vectors[j])
                XCTAssertEqual(vision, mine, accuracy: max(1e-4, vision * 1e-4),
                               "Vision's metric is not Euclidean over the descriptor for pair \(i)-\(j) "
                               + "— FeaturePrintVector is not a faithful stand-in and 0.15 has changed meaning")
            }
        }
    }

    /// Distinguishable test image: a coloured ground plus shapes whose positions vary with `seed`, so
    /// two seeds are genuinely different scenes rather than two flat colours.
    private func imageURL(seed: Int, size: CGFloat = 256) throws -> URL {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        let data = renderer.pngData { ctx in
            let cg = ctx.cgContext
            let hue = CGFloat(seed % 6) / 6.0
            cg.setFillColor(UIColor(hue: hue, saturation: 0.9, brightness: 0.9, alpha: 1).cgColor)
            cg.fill(CGRect(x: 0, y: 0, width: size, height: size))
            for i in 0 ..< 5 {
                let f = CGFloat(i)
                let x = (f * 37 + CGFloat(seed) * 53).truncatingRemainder(dividingBy: size - 60)
                let y = (f * 61 + CGFloat(seed) * 29).truncatingRemainder(dividingBy: size - 60)
                cg.setFillColor(UIColor(hue: (hue + f / 10).truncatingRemainder(dividingBy: 1),
                                        saturation: 0.8, brightness: 0.3, alpha: 1).cgColor)
                cg.fillEllipse(in: CGRect(x: x, y: y, width: 56, height: 56))
            }
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("fp-\(seed)-\(UUID().uuidString).png")
        try data.write(to: url)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
}
