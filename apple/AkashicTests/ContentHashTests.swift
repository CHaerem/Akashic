import XCTest
@testable import Akashic

/// DIFF-14 — exact-duplicate detection by content hash.
///
/// Distinct from `VisionPhotoScorer`'s feature-print grouping on purpose: that finds *near*
/// duplicates and is a heuristic, so it only ever proposes. A hash match is certainty, which is what
/// makes it the only one of the two safe to act on without asking the user.
final class ContentHashTests: XCTestCase {

    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("akashic-hash-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func file(_ name: String, _ bytes: Data) throws -> URL {
        let url = directory.appendingPathComponent(name)
        try bytes.write(to: url)
        return url
    }

    /// Against a known SHA-256, so this cannot drift into testing the implementation against itself.
    func testMatchesAKnownSHA256() {
        // echo -n "abc" | shasum -a 256
        XCTAssertEqual(ContentHash.sha256(of: Data("abc".utf8)),
                       "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    func testEmptyInputHashesToTheKnownEmptyDigest() {
        XCTAssertEqual(ContentHash.sha256(of: Data()),
                       "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    /// The property the whole feature rests on: identical bytes, identical hash, whatever the name.
    func testIdenticalBytesInDifferentFilesHashIdentically() throws {
        let bytes = Data((0 ..< 5000).map { UInt8($0 % 251) })
        let a = try file("first.jpg", bytes)
        let b = try file("second-copy.jpg", bytes)
        let hashA = try XCTUnwrap(ContentHash.sha256(ofFileAt: a))
        XCTAssertEqual(hashA, ContentHash.sha256(ofFileAt: b))
        XCTAssertEqual(hashA, ContentHash.sha256(of: bytes),
                       "the file and in-memory paths must agree, or a re-import compares apples to pears")
    }

    func testOneChangedByteChangesTheHash() throws {
        var bytes = Data((0 ..< 1000).map { UInt8($0 % 251) })
        let a = try file("a.jpg", bytes)
        bytes[500] = bytes[500] &+ 1
        let b = try file("b.jpg", bytes)
        XCTAssertNotEqual(ContentHash.sha256(ofFileAt: a), ContentHash.sha256(ofFileAt: b))
    }

    /// Chunked reading must not change the answer — that is the point of streaming rather than
    /// loading the file whole, and an off-by-one in the loop would only show on a multi-chunk file.
    func testChunkingDoesNotChangeTheResult() throws {
        // Deliberately not a multiple of any chunk size used here, so the last chunk is partial.
        let bytes = Data((0 ..< 70_001).map { UInt8($0 % 251) })
        let url = try file("big.mov", bytes)
        let whole = ContentHash.sha256(of: bytes)
        for chunk in [1, 7, 4096, 65_536, 1 << 20] {
            XCTAssertEqual(ContentHash.sha256(ofFileAt: url, chunkSize: chunk), whole,
                           "chunkSize \(chunk) must not change the digest")
        }
    }

    /// A missing file is unknown, not empty. Returning the empty-input digest here would make every
    /// unreadable photo look like a duplicate of every other unreadable photo.
    func testAMissingFileHashesToNil() {
        let missing = directory.appendingPathComponent("not-there.jpg")
        XCTAssertNil(ContentHash.sha256(ofFileAt: missing))
    }

    func testAnEmptyFileHashesToTheEmptyDigestNotNil() throws {
        let url = try file("empty.jpg", Data())
        XCTAssertEqual(ContentHash.sha256(ofFileAt: url),
                       "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                       "an empty file genuinely exists and genuinely has that digest")
    }
}
