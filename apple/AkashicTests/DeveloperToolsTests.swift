import XCTest
@testable import Akashic

/// Semantics of the hidden developer-tools gate (§4.3): a persisted unlock flag, the seven-tap
/// threshold, and the DEBUG auto-unlock.
final class DeveloperToolsTests: XCTestCase {

    private func makeDefaults(_ suite: String = "akashic.developer.tests.\(UUID().uuidString)")
        -> UserDefaults {
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    // MARK: - Persisted unlock (independent of build config)

    func testLockedByDefault() {
        let defaults = makeDefaults()
        XCTAssertFalse(DeveloperTools.isPersistentlyUnlocked(defaults: defaults))
    }

    func testSetUnlockedPersists() {
        let defaults = makeDefaults()
        DeveloperTools.setUnlocked(true, defaults: defaults)
        XCTAssertTrue(DeveloperTools.isPersistentlyUnlocked(defaults: defaults))
    }

    func testSetLockedClearsFlag() {
        let defaults = makeDefaults()
        DeveloperTools.setUnlocked(true, defaults: defaults)
        DeveloperTools.setUnlocked(false, defaults: defaults)
        XCTAssertFalse(DeveloperTools.isPersistentlyUnlocked(defaults: defaults))
    }

    // MARK: - Tap threshold

    func testTapsBelowThresholdDoNotUnlock() {
        XCTAssertEqual(DeveloperTools.tapsToUnlock, 7)
        for taps in 0..<7 {
            XCTAssertFalse(DeveloperTools.tapsReachUnlock(taps), "\(taps) taps should not unlock")
        }
    }

    func testSeventhTapUnlocks() {
        XCTAssertTrue(DeveloperTools.tapsReachUnlock(7))
        XCTAssertTrue(DeveloperTools.tapsReachUnlock(8))
    }

    // MARK: - DEBUG auto-unlock

    func testIsUnlockedReflectsDebugAutoUnlock() {
        let defaults = makeDefaults()
        // Even with the persisted flag cleared, DEBUG builds are always unlocked; Release builds
        // fall back to the persisted flag (false here).
        #if DEBUG
        XCTAssertTrue(DeveloperTools.isUnlocked(defaults: defaults))
        #else
        XCTAssertFalse(DeveloperTools.isUnlocked(defaults: defaults))
        #endif
    }
}
