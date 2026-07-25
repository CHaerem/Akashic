import SwiftUI

/// Light / Dark / Automatic, chosen in Settings.
///
/// Apple's own apps mostly *don't* offer this, and for good reason: iOS already has the setting
/// system-wide, and duplicating it usually signals an app that doesn't trust the platform. The
/// exception — and this app is in it — is media and viewer apps, where dark chrome frames the
/// content better regardless of what the rest of the system is doing (Halide and Darkroom both
/// ship this control for the same reason).
///
/// So: **Automatic is the default**, the system stays in charge unless the user says otherwise,
/// and the override exists because someone reading a trek in bright daylight and someone browsing
/// photos in bed want different things from the same app.
///
/// Note what this does *not* excuse. Choosing Light must produce a correct light app, not a
/// tolerable one — the appearance work (A1/A3) stands on its own, and this picker is an escape
/// hatch rather than a substitute for it. The immersive map stays dark in every mode (see
/// `GlobeExperienceView`), which is why the Settings row says so out loud instead of leaving the
/// user to wonder whether the globe is broken.
enum AppearancePreference: String, CaseIterable, Identifiable {
    case automatic
    case light
    case dark

    var id: String { rawValue }

    /// Stored under this key so the value survives launches; read via `@AppStorage`.
    static let storageKey = "akashic.appearance"

    var label: String {
        switch self {
        case .automatic: return "Automatic"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    /// What to hand SwiftUI. `nil` means "don't override" — the system decides.
    var colorScheme: ColorScheme? {
        switch self {
        case .automatic: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}
