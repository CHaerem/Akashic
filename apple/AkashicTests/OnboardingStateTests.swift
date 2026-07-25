import XCTest
@testable import Akashic

/// Semantics of the first-run onboarding flag (§4.2): shown once, suppressed under tests and the
/// screenshot env override, and reset by "Replay intro".
final class OnboardingStateTests: XCTestCase {

    private func makeDefaults(_ suite: String = "akashic.onboarding.tests.\(UUID().uuidString)")
        -> UserDefaults {
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    /// An environment dict with no XCTest marker, so `shouldShow` isn't auto-suppressed.
    private let cleanEnv: [String: String] = [:]

    // MARK: - First run vs. seen

    func testShowsOnFreshInstall() {
        let defaults = makeDefaults()
        XCTAssertTrue(OnboardingState.shouldShow(defaults: defaults, environment: cleanEnv))
    }

    func testDoesNotShowAfterMarkSeen() {
        let defaults = makeDefaults()
        OnboardingState.markSeen(defaults: defaults)
        XCTAssertFalse(OnboardingState.shouldShow(defaults: defaults, environment: cleanEnv))
    }

    func testResetShowsAgain() {
        let defaults = makeDefaults()
        OnboardingState.markSeen(defaults: defaults)
        OnboardingState.reset(defaults: defaults)
        XCTAssertTrue(OnboardingState.shouldShow(defaults: defaults, environment: cleanEnv))
    }

    // MARK: - Suppression seams

    func testSuppressedUnderXCTest() {
        let defaults = makeDefaults()
        let env = ["XCTestConfigurationFilePath": "/tmp/whatever.xctestconfiguration"]
        XCTAssertTrue(OnboardingState.isSuppressed(environment: env))
        XCTAssertFalse(OnboardingState.shouldShow(defaults: defaults, environment: env))
    }

    func testSuppressedBySkipEnvOverride() {
        let defaults = makeDefaults()
        let env = ["AKASHIC_SKIP_ONBOARDING": "1"]
        XCTAssertTrue(OnboardingState.isSuppressed(environment: env))
        XCTAssertFalse(OnboardingState.shouldShow(defaults: defaults, environment: env))
    }

    func testSkipOverrideOnlyForExactlyOne() {
        // A value other than "1" does not suppress.
        let env = ["AKASHIC_SKIP_ONBOARDING": "0"]
        XCTAssertFalse(OnboardingState.isSuppressed(environment: env))
    }

    func testSuppressionWinsOverFreshInstall() {
        // Even a fresh install stays hidden when suppressed (automation must never see the cover).
        let defaults = makeDefaults()
        let env = ["AKASHIC_SKIP_ONBOARDING": "1"]
        XCTAssertFalse(OnboardingState.shouldShow(defaults: defaults, environment: env))
    }

    func testCleanEnvironmentIsNotSuppressed() {
        XCTAssertFalse(OnboardingState.isSuppressed(environment: cleanEnv))
    }

    /// A screenshot/demo harness screen must never be covered by the first-run onboarding, so the
    /// harness no longer has to also set AKASHIC_SKIP_ONBOARDING. (quality gate: screenshot harness
    /// screens can be covered by first-run onboarding.)
    func testSuppressedWhenScreenshotHarnessScreenIsSet() {
        let defaults = makeDefaults()
        for screen in ["photos", "photogrid", "editsheet", "widgets"] {
            let env = ["AKASHIC_SCREEN": screen]
            XCTAssertTrue(OnboardingState.isSuppressed(environment: env), "AKASHIC_SCREEN=\(screen) suppresses onboarding")
            XCTAssertFalse(OnboardingState.shouldShow(defaults: defaults, environment: env),
                           "a fresh install with AKASHIC_SCREEN set never shows the cover")
        }
    }
}
