import Foundation
import os

/// Diagnostic logging for the CloudKit sync layer.
///
/// This layer cannot be debugged from the UI: `CKSyncEngine` drives itself, most of the
/// interesting work happens in delegate callbacks, and on the Simulator the failure mode is
/// simply "nothing happens". So the event stream is logged.
///
/// **Off by default.** Two independent switches turn it on, OR-ed together:
///
///   * `AKASHIC_SYNC_LOG=1` in the environment (via `SIMCTL_CHILD_AKASHIC_SYNC_LOG=1` when
///     launching through `simctl`) — the development switch, unchanged.
///   * A persisted flag under `persistedKey`, flipped by the **Settings › Diagnostics** toggle
///     (`SettingsView`) — the DIFF-16 addition, and the only one a signed build can reach.
///
/// ## Why the second switch exists (DIFF-16, measured on device)
///
/// DIFF-15's un-downloaded journey rows failed on a real TestFlight install against Production —
/// the one surface no simulator can exercise — and the failure was undiagnosable, because every
/// line that would have explained it goes through this type and an installed app cannot be given an
/// environment variable. "Quiet and safe" on the Simulator turns out to mean SILENT AND UNDIAGNOSABLE
/// on the only build that matters. A toggle the owner can reach on the device is therefore the first
/// fix of the set, ahead of every candidate root cause: without it each of those is a guess.
///
/// Read the stream on a connected device with Console.app (subsystem `no.akashic.app`,
/// category `sync`), or on a simulator with:
///
/// ```
/// xcrun simctl spawn <udid> log stream --predicate 'subsystem == "no.akashic.app"' --style compact
/// ```
enum SyncLog {

    /// The development switch. Unchanged, and deliberately still honoured: a `simctl` run must not
    /// have to write a preference first.
    static let environmentVariable = "AKASHIC_SYNC_LOG"

    /// The persisted switch, owned by the Settings › Diagnostics toggle. Absent (not `false`) when
    /// off, so the default state is "nothing stored" exactly as before this existed.
    static let persistedKey = "akashic.sync.log.enabled"

    /// Evaluated once, and that is correct **here**: a process's own environment cannot change
    /// under it. The contrast with `isEnabled` below is the whole lesson of this file.
    private static let isEnabledByEnvironment =
        ProcessInfo.processInfo.environment[environmentVariable] == "1"

    /// Whether logging is on **right now**.
    ///
    /// ## This was `static let isEnabled = …` and that was the second half of DIFF-16's defect
    ///
    /// A `static let` is evaluated exactly once, lazily, on first use — so a toggle that writes
    /// `UserDefaults` after any line has already been logged would appear to do nothing, and the
    /// owner would conclude the toggle was broken rather than that sync had nothing to say. A
    /// COMPUTED property cannot have that failure mode. `UserDefaults` is documented thread-safe and
    /// caches in memory after the first read, and the call sites here are per-batch and per-event
    /// rather than per-record, so this is not a hot path worth measuring — it is a correctness fix
    /// with no measurable cost, and the cheap-looking `let` is what made the feature useless.
    static var isEnabled: Bool { isEnabled(in: .standard) }

    /// The decision, against an explicit store, so the runtime behaviour above is unit-testable
    /// without writing to the shared defaults domain.
    static func isEnabled(in defaults: UserDefaults) -> Bool {
        isEnabledByEnvironment || defaults.bool(forKey: persistedKey)
    }

    /// The persisted flag alone — what the Settings toggle binds to. Independent of the environment
    /// switch, so a `simctl` run with `AKASHIC_SYNC_LOG=1` does not make the toggle *look* on.
    static func isPersistentlyEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: persistedKey)
    }

    /// Turn persistent logging on or off. Off REMOVES the key rather than storing `false`, so a
    /// device that has never used the toggle and one that turned it off are the same state.
    static func setPersistentlyEnabled(_ enabled: Bool, defaults: UserDefaults = .standard) {
        if enabled {
            defaults.set(true, forKey: persistedKey)
        } else {
            defaults.removeObject(forKey: persistedKey)
        }
    }

    private static let logger = Logger(subsystem: "no.akashic.app", category: "sync")

    static func log(_ message: @autoclosure () -> String) {
        guard isEnabled else { return }
        let text = message()
        logger.log("\(text, privacy: .public)")
    }

    static func error(_ message: @autoclosure () -> String) {
        // Errors are always logged: they are rare, actionable and never chatty.
        let text = message()
        logger.error("\(text, privacy: .public)")
    }
}
