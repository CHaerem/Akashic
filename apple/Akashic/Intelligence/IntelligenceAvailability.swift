import Foundation
import Combine

#if canImport(FoundationModels)
import FoundationModels
#endif

/// M6 — the Akashic Intelligence groundwork (COMMERCIALIZATION-PLAN §10).
///
/// This file is the **single gate** for the whole on-device-model feature family. Every piece of
/// Intelligence UI (Draft a day note, Suggest day names) asks `Intelligence.isAvailable` — never
/// FoundationModels directly — so the features are *absent, never broken* on devices that can't
/// serve them: no dead buttons, no "not available" error sheets. When the gate is closed the entry
/// points simply don't render.
///
/// ## The integration point (plan §10)
/// Apple's **Foundation Models framework** (iOS 26+, `import FoundationModels`) exposes an on-device
/// ~3B model via `SystemLanguageModel.default`. Its `.availability` reports `.available` or
/// `.unavailable(reason)` — the model is present only on Apple-Intelligence-capable hardware with
/// the feature enabled and the assets downloaded. The framework itself only exists in the iOS 26 SDK,
/// so every reference to it is wrapped in `#if canImport(FoundationModels)` (older SDKs/CI still
/// build) and gated at runtime by `#available(iOS 26.0, *)` (the app targets iOS 17).

// MARK: - Availability tiers

/// The resolved availability of the on-device model, expressed independently of the FoundationModels
/// SDK so the entire gate is unit-testable on any OS (including CI hosts without the framework).
enum ModelAvailability: Equatable {
    /// The model is present and ready to serve requests.
    case available
    /// Running below iOS 26 (or built against an SDK without FoundationModels) — the framework is
    /// simply not there.
    case unavailableOSTooOld
    /// iOS 26+, but this device/model can't serve (not Apple-Intelligence-eligible, Apple
    /// Intelligence not enabled, or the model assets aren't downloaded yet).
    case unavailableNoIntelligence
    /// The `AKASHIC_DISABLE_AI=1` kill switch is set (deterministic tests + screenshots).
    case disabledByEnv

    var isAvailable: Bool { self == .available }
}

// MARK: - Gate

/// The observable Intelligence gate the SwiftUI layer consumes. Injected as an `EnvironmentObject`
/// at the app root; UI reads `isAvailable` and never touches FoundationModels itself.
@MainActor
final class Intelligence: ObservableObject {

    /// Environment kill switch, highest precedence. Set `AKASHIC_DISABLE_AI=1` to force the whole
    /// feature family off for deterministic screenshots and UI tests.
    static let disableEnvKey = "AKASHIC_DISABLE_AI"

    /// The resolved availability. Published so entry points refresh if it ever changes (e.g. the
    /// model finishes downloading during a session and a re-probe is issued).
    @Published private(set) var availability: ModelAvailability

    /// The one question all Intelligence UI asks.
    var isAvailable: Bool { availability.isAvailable }

    /// Inject a fixed availability (tests, previews, screenshots).
    init(availability: ModelAvailability) {
        self.availability = availability
    }

    /// Probe the real environment + FoundationModels at construction.
    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.availability = Self.probe(environment: environment)
    }

    /// Re-probe (e.g. after returning to the foreground, in case the model finished downloading).
    func refresh(environment: [String: String] = ProcessInfo.processInfo.environment) {
        availability = Self.probe(environment: environment)
    }

    // MARK: Probe

    /// Resolve availability from the live environment and the FoundationModels framework.
    ///
    /// The precedence and the raw signals are handed to the pure `resolve(...)` below so the whole
    /// decision (kill-switch precedence, below-iOS-26 path, model-unavailable path) is testable
    /// without an actual model or a specific OS version.
    static func probe(environment: [String: String] = ProcessInfo.processInfo.environment)
        -> ModelAvailability {
        let disabled = environment[disableEnvKey] == "1"

        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let modelReady: Bool
            switch SystemLanguageModel.default.availability {
            case .available: modelReady = true
            case .unavailable: modelReady = false
            }
            return resolve(disabledByEnv: disabled, frameworkAvailable: true, modelReady: modelReady)
        } else {
            // Built against the iOS 26 SDK but running on an older OS: the framework symbols exist
            // at compile time but the model does not at runtime.
            return resolve(disabledByEnv: disabled, frameworkAvailable: false, modelReady: false)
        }
        #else
        // Built against an SDK without FoundationModels (older Xcode / CI).
        return resolve(disabledByEnv: disabled, frameworkAvailable: false, modelReady: false)
        #endif
    }

    /// Pure resolver — the entire availability decision as data, no OS or SDK dependency.
    ///
    /// Precedence: the env kill switch wins over everything; then the framework must exist (iOS 26+
    /// with FoundationModels); then the model must actually be ready on this device.
    static func resolve(disabledByEnv: Bool, frameworkAvailable: Bool, modelReady: Bool)
        -> ModelAvailability {
        if disabledByEnv { return .disabledByEnv }
        if !frameworkAvailable { return .unavailableOSTooOld }
        return modelReady ? .available : .unavailableNoIntelligence
    }
}

extension Intelligence {
    /// A non-probing gate for SwiftUI previews (always unavailable, so previews never try to reach
    /// the model). Not `#if DEBUG`-gated because `#Preview` bodies compile in Release too.
    static var previewUnavailable: Intelligence {
        Intelligence(availability: .unavailableNoIntelligence)
    }
}
