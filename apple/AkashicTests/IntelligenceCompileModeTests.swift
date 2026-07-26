import XCTest
@testable import Akashic

/// QUA-05 — make the compile mode of the Intelligence family **visible** rather than silent.
///
/// Every Foundation Models call site sits inside `#if canImport(FoundationModels)`. On a toolchain
/// without the iOS 26 SDK that entire family compiles to nothing, with a green build and no warning.
/// CI runs `macos-15` (Xcode 16.4), so roughly 517 lines across four files are type-checked by
/// nothing automated.
///
/// These tests deliberately do **not** fail on that. `macos-15` genuinely lacks the framework, so
/// asserting its presence would just re-create the permanently-red required gate that QUA-03 spent
/// a day removing — and a gate everyone learns to ignore is worse than no gate. The hard guarantee
/// lives where it belongs: `AKASHIC_REQUIRE_INTELLIGENCE` makes a missing framework a build error in
/// the archive that actually ships (see `IntelligenceAvailability.swift`).
///
/// What these do instead is print the mode into every test run, so "the AI code was not compiled" is
/// something you can see in a log rather than something you have to remember.
final class IntelligenceCompileModeTests: XCTestCase {

    /// True when this build actually compiled the Foundation Models code paths.
    static var didCompileIntelligence: Bool {
        #if canImport(FoundationModels)
        return true
        #else
        return false
        #endif
    }

    func testReportsWhetherTheIntelligenceFamilyWasCompiled() {
        let compiled = Self.didCompileIntelligence
        let detail = compiled
            ? "The Intelligence code paths ARE compiled and type-checked by this run."
            : "The Intelligence code paths are NOT compiled: ~517 lines across DayNamer, "
              + "DayNoteDrafter, FactDrafter and IntelligenceAvailability are unchecked here. "
              + "The AKASHIC_REQUIRE_INTELLIGENCE tripwire still protects the shipping archive."
        // Printed unconditionally: this line is the whole point of the test.
        print("[QUA-05] FoundationModels available to this toolchain: \(compiled). \(detail)")
        XCTAssertNotNil(detail, "this test reports the compile mode; it deliberately does not gate")
    }

    /// `probe` is the half that touches the SDK and the OS, so it is the half the pure
    /// `resolve(...)` tests cannot reach — and therefore the half that silently rots on a toolchain
    /// without the framework. Assert it stays coherent on whatever toolchain is running: never
    /// trapping, and never claiming availability it cannot have.
    @MainActor
    func testProbeIsCoherentOnThisToolchain() {
        let availability = Intelligence.probe(environment: [:])
        if Self.didCompileIntelligence {
            // With the SDK present the answer depends on the host and the model download state, so
            // only coherence is assertable — the simulator has no model, the developer's Mac may.
            XCTAssertNotEqual(availability, .disabledByEnv,
                              "no kill switch was set, so it must not report one")
        } else {
            XCTAssertEqual(availability, .unavailableOSTooOld,
                           "without the framework the probe must give the SDK reason, not a device reason")
        }
    }

    /// The kill switch has to win on every toolchain — it is what makes screenshots and UI tests
    /// deterministic, and a gate that ignores it in one build configuration is not a kill switch.
    /// Goes through `probe` rather than `resolve` so it exercises the `#if`-laden path.
    @MainActor
    func testKillSwitchWinsThroughProbeOnAnyToolchain() {
        XCTAssertEqual(Intelligence.probe(environment: [Intelligence.disableEnvKey: "1"]),
                       .disabledByEnv)
    }

    /// Whatever the toolchain, an unavailable gate must mean the UI does not render — the whole
    /// "absent, never broken" contract rests on this one boolean.
    func testUnavailableAlwaysMeansNotAvailable() {
        for state: ModelAvailability in [.unavailableOSTooOld, .unavailableNoIntelligence, .disabledByEnv] {
            XCTAssertFalse(state.isAvailable, "\(state) must not read as available")
        }
        XCTAssertTrue(ModelAvailability.available.isAvailable)
    }
}
