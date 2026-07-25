import Foundation
import os

/// Diagnostic logging for the CloudKit sync layer.
///
/// This layer cannot be debugged from the UI: `CKSyncEngine` drives itself, most of the
/// interesting work happens in delegate callbacks, and on the Simulator the failure mode is
/// simply "nothing happens". So the event stream is logged.
///
/// **Off by default**, enabled for a run with `AKASHIC_SYNC_LOG=1` (via
/// `SIMCTL_CHILD_AKASHIC_SYNC_LOG=1` when launching through `simctl`). Read it with:
///
/// ```
/// xcrun simctl spawn <udid> log stream --predicate 'subsystem == "no.akashic.app"' --style compact
/// ```
enum SyncLog {
    static let isEnabled = ProcessInfo.processInfo.environment["AKASHIC_SYNC_LOG"] == "1"

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
