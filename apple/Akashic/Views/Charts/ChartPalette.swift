import SwiftUI

/// Small adaptive palette shared by the two elevation charts (`InteractiveElevationProfileView`,
/// `MiniElevationProfileView`). These charts live on the Stats page, which now follows the system
/// appearance like the rest of the app's chrome — unlike `MapPalette` (deliberately fixed-light-
/// on-dark, because the map stays immersive in both appearances), this palette adapts.
///
/// Before this existed, both charts drew their base curve as a literal `.white` stroke/fill —
/// invisible once the Stats page stopped being forced dark (only the amber-ish camp dots, drawn
/// with their own colour, still showed). This is the fix, following the same techniques `Theme`
/// already established rather than inventing new ones.
enum ChartPalette {
    /// Base elevation curve + its area fill. `Theme.textPrimary` (== `.primary`) inverts
    /// black/white automatically, exactly like the axis labels drawn beside the chart.
    static let line = Theme.textPrimary
    static let areaFillTop = Theme.textPrimary.opacity(0.15)
    static let areaFillBottom = Theme.textPrimary.opacity(0)

    /// "Selected day" / primary chart accent. `.systemBlue` is Apple's own semantic blue — it
    /// already carries separate light/dark tuning (and an Increase Contrast variant), so it does
    /// the adapting instead of the hand-picked `#3b82f6`/`#60a5fa` hex pair this replaces. That
    /// pair read fine against the old fixed-dark page but drops under 3:1 contrast against a
    /// white one, which is exactly the kind of gap a system colour is built to close.
    static let accent = Color(uiColor: .systemBlue)

    /// Keyline ring drawn around a marker dot — a hair of page-background colour between the dot
    /// and whatever's drawn behind it (the line/area), the same "ring matches the page" trick
    /// system list rows use for separators. Adaptive so it reads in both appearances instead of
    /// the old fixed black/white rings that assumed one fixed page colour.
    static let dotRing = Theme.background
}
