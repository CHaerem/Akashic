import Foundation

/// The hidden developer-tools gate (COMMERCIALIZATION-PLAN §4.3).
///
/// The migration workshop — both importers, the persistence-mode override, and the
/// container/environment rows — is relocated behind this gate rather than deleted, because the
/// runbook still depends on those tools. A customer never sees them; we reach them with the
/// classic seven taps on the version row.
///
/// Unlock policy:
///   * DEBUG builds are **always** unlocked (`#if DEBUG`), so development never has to tap.
///   * Release builds start locked and are unlocked by seven taps on the version row; the
///     unlock is persisted in `UserDefaults` so it survives relaunches.
///
/// The persisted flag and the tap arithmetic are separated from the `#if DEBUG` shortcut so both
/// can be unit-tested without depending on the build configuration.
enum DeveloperTools {

    /// Persisted "developer section unlocked" flag (Release builds).
    static let unlockedKey = "akashic.developer.unlocked"

    /// Taps on the version row required to reveal the developer section.
    static let tapsToUnlock = 7

    /// Whether the developer section should be visible.
    ///
    /// DEBUG auto-unlocks. Release returns false unconditionally (SHIP-09): the migration workshop
    /// — a persistence-mode override that can repoint the customer's store, a folder picker, and a
    /// "Run import to CloudKit…" button whose own dialog says it writes the real production
    /// database — has no business existing in a paid binary, however many taps guard it. The
    /// persisted flag is deliberately ignored rather than cleared, so a Release build cannot be
    /// unlocked even by a device that unlocked it under an earlier build.
    ///
    /// `Debug-CloudKit` and `Debug-Production` both define DEBUG, which is where the runbook
    /// actually needs these tools, so nothing operational is lost.
    static func isUnlocked(defaults: UserDefaults = .standard) -> Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    /// The raw persisted flag, independent of the DEBUG auto-unlock. Exposed so the tap/unlock
    /// semantics are testable regardless of the configuration the tests run under.
    static func isPersistentlyUnlocked(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: unlockedKey)
    }

    /// Persist (or clear) the unlock.
    static func setUnlocked(_ unlocked: Bool, defaults: UserDefaults = .standard) {
        if unlocked {
            defaults.set(true, forKey: unlockedKey)
        } else {
            defaults.removeObject(forKey: unlockedKey)
        }
    }

    /// Whether `count` taps have reached the unlock threshold. Pure helper for the view's tap
    /// counter.
    static func tapsReachUnlock(_ count: Int) -> Bool {
        count >= tapsToUnlock
    }
}
