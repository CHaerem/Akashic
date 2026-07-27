import Foundation
import Vision

/// Supplies the per-photo measurements `PhotoCuration` decides from (DIFF-04).
///
/// A protocol so the curation policy can be exercised against fixed scores with no Vision, no image
/// files and no device — the same seam discipline as `SyncEngineProtocol` and `StoreKitProviding`.
// QUA-08: `Sendable` because `PhotoCurationService` is a Sendable value that stores one of these
// and crosses an isolation boundary with it. Both conformers qualify: `VisionPhotoScorer` is a
// struct of two value-typed settings, and the test fakes hold fixed scores.
protocol PhotoScoring: Sendable {
    /// Score the given photos. Implementations must tolerate missing bytes (return a score with
    /// `aesthetics == nil` rather than dropping the photo) and must honour cancellation.
    /// QUA-08: `dayOf` is `@Sendable` because implementations resolve it before fanning out into
    /// concurrent work, and the value crosses that boundary. Annotating the seam checks callers'
    /// captures rather than trusting them — `VisionPhotoScorer` closes over a `PhotoDayMatcher`.
    func score(_ photos: [Photo], dayOf: @Sendable (Photo) -> Int?) async -> [PhotoScore]
}

/// A feature print flattened to plain numbers, so it can cross a concurrency boundary. (QUA-35)
///
/// `VNFeaturePrintObservation` is a non-Sendable Apple class that will never become one, and the
/// scorer has to carry one out of the child task that produced it — grouping is inherently pairwise,
/// so it cannot be decided while scoring a single image. QUA-08 solved that with an
/// `@unchecked Sendable` box, on the grounds that re-implementing Vision's metric was unverifiable
/// while nothing tested `groupNearDuplicates`.
///
/// What changed is *why* that argument no longer holds. Nothing tested `groupNearDuplicates` **because
/// it could not be tested**: its parameter was an Apple class no test can construct, and every Vision
/// ML request fails in the simulator with "Failed to create espresso context" (see QUA-38). Taking
/// plain floats is what makes the union-find, the burst-drift behaviour and the threshold boundaries
/// testable at all — so the refactor removes an unchecked promise *and* buys the coverage whose
/// absence was the reason for keeping it.
///
/// The one thing it does assert is that Vision's `computeDistance` is Euclidean over this descriptor.
/// That is pinned by `FeaturePrintVectorTests.testComputeDistanceIsEuclideanOverTheDescriptor`, which
/// skips in the simulator and runs on a device — the only place it can.
struct FeaturePrintVector: Sendable, Equatable {
    let values: [Float]

    /// Copies the descriptor out of the observation, inside the task that owns it.
    ///
    /// Returns nil for a non-float descriptor rather than reinterpreting bytes it does not understand:
    /// a wrong element type would produce plausible numbers and a silently wrong grouping.
    init?(_ observation: VNFeaturePrintObservation) {
        guard observation.elementType == .float, observation.elementCount > 0 else { return nil }
        values = observation.data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        guard !values.isEmpty else { return nil }
    }

    /// Test seam: build one directly from known numbers.
    init(values: [Float]) { self.values = values }

    /// Euclidean distance — what `VNFeaturePrintObservation.computeDistance` computes over the same
    /// numbers. Mismatched lengths cannot be compared meaningfully, so they report `.infinity` and
    /// simply never group, rather than crashing on a descriptor from a different model revision.
    func distance(to other: FeaturePrintVector) -> Float {
        guard values.count == other.values.count else { return .infinity }
        var sum: Float = 0
        for i in values.indices {
            let d = values[i] - other.values[i]
            sum += d * d
        }
        return sum.squareRoot()
    }
}

/// Vision-backed scoring: aesthetics, utility-image detection and near-duplicate grouping.
///
/// ## Availability, and why it is not gated like Intelligence
/// `VNCalculateImageAestheticsScoresRequest` is iOS 18+; `VNGenerateImageFeaturePrintRequest` is
/// iOS 13+. The app targets iOS 17, so aesthetics is `#available`-gated per call and simply comes
/// back nil below 18 — at which point `PhotoCuration` falls back to `sortOrder`, which is exactly
/// today's behaviour. Duplicate detection works on every supported OS. So unlike the Foundation
/// Models family, this feature is never *absent*: it degrades. That is the point of choosing Vision.
///
/// ## Why it reads thumbnails
/// Scoring runs over `thumbnailFileURL`, not the original. A 939-photo journey is several gigabytes
/// of originals; the thumbnails are the bytes already on disk for the grid, and both requests are
/// resolution-tolerant. Reading originals here would reintroduce the memory profile that makes
/// `PhotoIngestService`'s video path a problem (QUA-13).
struct VisionPhotoScorer: PhotoScoring {

    /// Feature-print distance below which two images are treated as the same moment.
    ///
    /// Vision's `computeDistance` is unbounded and scene-dependent, so this is a heuristic, and it
    /// is deliberately tight: a false positive hides a photo the user wanted, which is worse than
    /// leaving a near-duplicate in. 0.15 keeps burst frames and re-encodes together while separating
    /// genuinely different compositions of the same subject. Exposed so a test can pin the boundary.
    var duplicateDistance: Float = 0.15

    /// How many images are scored concurrently. Vision requests are CPU/ANE-bound and each holds a
    /// decoded image, so unbounded concurrency over 939 photos is how an app gets jetsammed.
    var maxConcurrent: Int = 4

    /// What Vision saw across a set of photographs, as words (DIFF-05).
    ///
    /// Feeds `DayNoteInput.photoSubjects`, closing the gap where the plan promised drafting from
    /// "the day's photos (Vision labels)" while the drafter only ever received a count.
    ///
    /// Aggregated across the day and ranked by how many photographs agree, because one confident
    /// label on one frame says much less than the same label on six — and a day note should describe
    /// the day, not its most photogenic second.
    static func subjects(in photos: [Photo],
                         minimumConfidence: Float = 0.35,
                         limit: Int = 8) async -> [String] {
        var counts: [String: Int] = [:]
        for photo in photos {
            guard !photo.isVideo, let url = photo.thumbnailFileURL else { continue }
            if Task.isCancelled { break }
            let request = VNClassifyImageRequest()
            guard (try? VNImageRequestHandler(url: url, options: [:]).perform([request])) != nil,
                  let observations = request.results else { continue }
            // Only the labels this image is reasonably sure about, and only once per image, so a
            // single photograph cannot stuff the ranking with twenty near-synonyms.
            let confident = Set(observations
                .filter { $0.confidence >= minimumConfidence }
                .prefix(6)
                .map { $0.identifier })
            for label in confident { counts[label, default: 0] += 1 }
        }
        // Sorted by agreement, then alphabetically so the result is deterministic — an unstable
        // subject list would make the same day draft differently on each tap.
        return counts.sorted { ($0.value, $1.key) > ($1.value, $0.key) }
            .prefix(limit)
            .map { $0.key.replacingOccurrences(of: "_", with: " ") }
    }

    func score(_ photos: [Photo], dayOf: @Sendable (Photo) -> Int?) async -> [PhotoScore] {
        // Day assignment is resolved up front on the caller's actor: `dayOf` closes over the
        // matcher, which is not Sendable, and the concurrent work below must not touch it.
        let inputs: [(photo: Photo, day: Int?)] = photos.map { ($0, dayOf($0)) }

        var scores: [PhotoScore] = []
        var prints: [(id: String, print: FeaturePrintVector)] = []

        // Chunked rather than a bare TaskGroup so at most `maxConcurrent` images are decoded at
        // once. `chunked(into:)` is the existing Array helper from PhotoMediaService.
        for chunk in inputs.chunked(into: maxConcurrent) {
            if Task.isCancelled { return scores }
            let measured = await withTaskGroup(of: (PhotoScore, FeaturePrintVector?).self) { group in
                for input in chunk {
                    group.addTask { await Self.measure(input.photo, day: input.day) }
                }
                var out: [(PhotoScore, FeaturePrintVector?)] = []
                for await result in group { out.append(result) }
                return out
            }
            for (score, vector) in measured {
                scores.append(score)
                if let vector { prints.append((score.id, vector)) }
            }
        }

        // Grouping is a second pass because it is inherently pairwise — a photo's group depends on
        // every other photo, so it cannot be decided while scoring one image.
        let groups = Self.groupNearDuplicates(prints, threshold: duplicateDistance)
        for i in scores.indices {
            scores[i].duplicateGroup = groups[scores[i].id]
        }
        return scores
    }

    // MARK: - One image

    private static func measure(_ photo: Photo,
                                day: Int?) async -> (PhotoScore, FeaturePrintVector?) {
        var score = PhotoScore(id: photo.id,
                               dayNumber: day,
                               sortOrder: photo.sortOrder,
                               isVideo: photo.isVideo)

        // Videos get an identity row and no Vision work: `PhotoCuration` excludes them from
        // proposals anyway, and decoding a frame to score it would cost more than it can return.
        guard !photo.isVideo, let url = photo.thumbnailFileURL else { return (score, nil) }

        let handler = VNImageRequestHandler(url: url, options: [:])

        var requests: [VNRequest] = []
        let featurePrint = VNGenerateImageFeaturePrintRequest()
        requests.append(featurePrint)

        var aesthetics: VNRequest?
        if #available(iOS 18.0, *) {
            let request = VNCalculateImageAestheticsScoresRequest()
            aesthetics = request
            requests.append(request)
        }

        do {
            try handler.perform(requests)
        } catch {
            // A single unreadable image must never fail the pass — it degrades to "unscored", which
            // the policy already handles by falling back to sortOrder.
            return (score, nil)
        }

        if #available(iOS 18.0, *),
           let observation = (aesthetics as? VNCalculateImageAestheticsScoresRequest)?
               .results?.first as? VNImageAestheticsScoresObservation {
            score.aesthetics = Double(observation.overallScore)
            score.isUtility = observation.isUtility
        }

        return (score, (featurePrint.results?.first as? VNFeaturePrintObservation)
            .flatMap(FeaturePrintVector.init))
    }

    // MARK: - Near-duplicate grouping

    /// Single-link grouping by feature-print distance: id -> group number.
    ///
    /// Union-find rather than "compare against group representatives", because burst frames drift —
    /// frame 1 and frame 12 can exceed the threshold while every adjacent pair sits under it, and
    /// representative-matching would split one burst into several groups.
    static func groupNearDuplicates(_ prints: [(id: String, print: FeaturePrintVector)],
                                    threshold: Float) -> [String: Int] {
        guard prints.count > 1 else { return [:] }

        var parent = Array(0 ..< prints.count)
        func find(_ i: Int) -> Int {
            var root = i
            while parent[root] != root { root = parent[root] }
            var walk = i                       // path compression: bursts can be long
            while parent[walk] != walk { let next = parent[walk]; parent[walk] = root; walk = next }
            return root
        }
        func union(_ a: Int, _ b: Int) {
            let (ra, rb) = (find(a), find(b))
            if ra != rb { parent[max(ra, rb)] = min(ra, rb) }
        }

        for i in 0 ..< prints.count {
            for j in (i + 1) ..< prints.count {
                if prints[i].print.distance(to: prints[j].print) < threshold { union(i, j) }
            }
        }

        // Only emit ids that share a root with someone else; a singleton is not a duplicate.
        var membersByRoot: [Int: [Int]] = [:]
        for i in 0 ..< prints.count { membersByRoot[find(i), default: []].append(i) }

        var result: [String: Int] = [:]
        // Number groups by their lowest member index so the numbering is deterministic.
        for (group, root) in membersByRoot.keys.sorted().enumerated() {
            guard let members = membersByRoot[root], members.count > 1 else { continue }
            for i in members { result[prints[i].id] = group }
        }
        return result
    }
}
