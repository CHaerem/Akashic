import Foundation

/// Persistence + policy for the one-time first-run onboarding (COMMERCIALIZATION-PLAN §4.2).
///
/// The onboarding is shown exactly once, tracked by a single `UserDefaults` flag. All of the
/// "should we show it?" logic lives here (not in the view) so it can be unit-tested, and so both
/// the app root and the "Replay intro" Settings row share one source of truth.
///
/// Two suppression seams keep it out of automation:
///   * `AKASHIC_SKIP_ONBOARDING=1` — explicit opt-out for screenshots / UI tests.
///   * running under XCTest — detected by `XCTestConfigurationFilePath`, the same signal the
///     rest of the app uses (see `WidgetDataStore`, `SpotlightIndexer`) to no-op in the suite.
enum OnboardingState {

    /// Set to `true` once the user has finished (or skipped) the intro.
    static let hasSeenKey = "akashic.onboarding.hasSeen"

    /// Whether the intro should be presented on this launch.
    ///
    /// Environment/test suppression wins over the stored flag, so an automation run never sees
    /// the cover even on a fresh install. Injectable `defaults`/`environment` make every branch
    /// unit-testable.
    static func shouldShow(defaults: UserDefaults = .standard,
                           environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
        if isSuppressed(environment: environment) { return false }
        return !defaults.bool(forKey: hasSeenKey)
    }

    /// True when the environment forbids showing onboarding at all (tests / screenshots).
    static func isSuppressed(environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
        if environment["XCTestConfigurationFilePath"] != nil { return true }
        if environment["AKASHIC_SKIP_ONBOARDING"] == "1" { return true }
        // A screenshot/demo harness screen (AKASHIC_SCREEN=photos/photogrid/editsheet/widgets) must
        // never be covered by the first-run onboarding, so every ad-hoc harness launch no longer
        // has to also remember AKASHIC_SKIP_ONBOARDING. (quality gate: screenshot harness screens
        // can be covered by first-run onboarding.)
        if environment["AKASHIC_SCREEN"] != nil { return true }
        return false
    }

    /// Record that the intro has been seen, so it never appears again automatically.
    static func markSeen(defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: hasSeenKey)
    }

    /// Clear the flag so the intro shows again next time it is evaluated. Backs the
    /// "Replay intro" Settings row.
    static func reset(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: hasSeenKey)
    }
}
