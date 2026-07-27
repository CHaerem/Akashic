import Foundation
import os

/// Shared, serialised ISO-8601 parsing and formatting. (QUA-08)
///
/// ## Why this file exists
///
/// Nine files kept their own `private static let` `ISO8601DateFormatter` — twelve of them in total,
/// all with the same two shapes (`[.withInternetDateTime]`, plus a fractional-seconds variant).
/// Under strict concurrency every one is "static property is not concurrency-safe because
/// non-`Sendable` type `ISO8601DateFormatter` may have shared mutable state", and at least one of
/// them is a genuine race rather than a formality: `PhotoDayMatcher.parseDate` is reached from
/// `@MainActor JourneyStore` during SwiftUI body evaluation **and**, concurrently, from the
/// cooperative pool via nonisolated `async` `PhotoCurationService.curate` and
/// `PublicMirrorPublisher.publish`.
///
/// ## Why serialising, and not `nonisolated(unsafe)`
///
/// Because Apple answered this question already, and the answer was no. In
/// `Foundation.framework/Headers`, `NSDateFormatter` carries
/// `NS_SWIFT_SENDABLE // All mutable state protected by locks, subclasses must be thread-safe` —
/// and `NSISO8601DateFormatter`, declared in the same family, carries **no such annotation**.
/// Neither does `NSRelativeDateTimeFormatter`. That is a per-class decision made deliberately, not
/// an omission: `DateOnly.formatter` in `JSONCoding.swift` is a plain `DateFormatter` and produces
/// no warning at all, precisely because Apple vouched for that one.
///
/// So `nonisolated(unsafe)` on an `ISO8601DateFormatter` would be this codebase asserting the exact
/// property Apple looked at and declined to assert. An unfair lock costs tens of nanoseconds
/// uncontended against a multi-microsecond ICU parse, which is cheaper than the per-call formatter
/// construction it replaces — so the honest option is also the fast one.
///
/// `OSAllocatedUnfairLock` rather than `Mutex`: `Mutex` reads better but is iOS 18+, and the
/// deployment target is 17.0 (`project.yml:5`). `uncheckedState` is the sanctioned spelling for a
/// non-`Sendable` payload whose every access happens under the lock — which is enforced here by
/// the formatters being unreachable except through these three functions.
enum ISO8601Shared {

    /// Both formatters behind one lock. Held as a tuple rather than two locks so a parse that tries
    /// both takes the lock once.
    private static let formatters = OSAllocatedUnfairLock(uncheckedState: (
        plain: make(fractionalSeconds: false),
        fractional: make(fractionalSeconds: true)))

    private static func make(fractionalSeconds: Bool) -> ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = fractionalSeconds
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        return f
    }

    /// Parse an ISO-8601 instant, with or without fractional seconds. Returns nil for anything else
    /// — notably a bare `yyyy-MM-dd`, which callers that accept one follow up with `DateOnly`.
    ///
    /// Trying plain before fractional is a performance choice and not a semantic one: an
    /// `ISO8601DateFormatter` is strict in both directions, so the plain formatter returns nil for a
    /// string carrying fractional seconds and the fractional one returns nil for a string without
    /// them. Exactly one of the two can match, whichever order they are tried in — which is why the
    /// call sites this replaced could disagree about the order and still all be correct.
    static func date(from string: String?) -> Date? {
        guard let string, !string.isEmpty else { return nil }
        return formatters.withLockUnchecked { f in
            f.plain.date(from: string) ?? f.fractional.date(from: string)
        }
    }

    /// Format as `[.withInternetDateTime]` — no fractional seconds, which is what every call site
    /// this replaced emitted.
    ///
    /// Deliberately NOT overloaded with a `Date?` -> `String?` twin. That pair is ambiguous at every
    /// call site, because a `Date` promotes to `Date?` and both overloads then match — the compiler
    /// says `ambiguous use of 'string(from:)'`. Every caller already unwraps with `guard let` first,
    /// so the optional variant bought nothing and cost a build.
    static func string(from date: Date) -> String {
        formatters.withLockUnchecked { $0.plain.string(from: date) }
    }
}
