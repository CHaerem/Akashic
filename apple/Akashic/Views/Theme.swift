import SwiftUI
import UIKit

/// A thin adaptive layer over the system's own semantic colours.
///
/// Apple's design language is mostly *not inventing a palette*: this file leans on
/// `Color.primary`/`.secondary` and the system background/fill tiers wherever the system
/// already has the right answer, and keeps exactly one custom value — the brand accent
/// (periwinkle) — as a tint. It used to be 8 hand-picked `Color(red:)` values tuned for a
/// single dark appearance; now it is mostly type aliases onto system colours, which is why
/// it got smaller instead of growing a second (light-mode) palette next to the first.
///
/// This is also the ONE place the app's display-accessibility settings get resolved, so the
/// ~200 call sites that read `Theme.*` don't each need their own `@Environment` plumbing:
///  - **Increase Contrast** (`colorSchemeContrast`) has a direct `UITraitCollection` analogue
///    (`accessibilityContrast`), so `textSecondary`/`textTertiary`/`hairline` below are dynamic
///    `UIColor`s that inspect the trait themselves — the system re-resolves them whenever the
///    trait changes, exactly like light/dark, with no view code involved.
///  - **Reduce Transparency** (`accessibilityReduceTransparency`) has no trait-collection
///    analogue — it is a standalone `UIAccessibility` flag surfaced to SwiftUI only via the
///    environment — so it can't ride the same dynamic-colour trick. `themedMaterial` below is
///    ONE of four places that read it, not the only one: `GlobeMapComponents`'s
///    `mapOverlayMaterial` and `DayNavigationView` hand-roll the same
///    `reduceTransparency ? opaque : .ultraThinMaterial` swap against `MapPalette.overlaySurface`
///    (the map's own fixed-dark fill, not `Theme.surface`), and `StatsView`'s capsule needs a
///    `Shape.fill(_:)` call `themedMaterial`'s `.background(_:in:)` shape doesn't offer. All three
///    are documented at their own call sites; `themedMaterial` is just the one reusable modifier.
///  - **Reduce Motion** has no colour to swap and isn't handled here — see
///    `TrekCameraController` and `GlobeExperienceView`, where the motion actually lives.
enum Theme {
    /// The one brand colour this file keeps. Fixed across both appearances on purpose: this
    /// periwinkle already reads correctly on both a light and a dark `systemBackground` —
    /// inventing a second "light-mode accent" would be exactly the palette-growing this
    /// rewrite is supposed to avoid.
    static let accent = Color(red: 0.56, green: 0.62, blue: 1.0)
    static let accentSoft = accent.opacity(0.16)

    /// Foreground for text/icons drawn on an `accent`-filled control (the app's primary CTA
    /// buttons). This used to just reuse `background` — which only worked because `background`
    /// was a fixed dark navy that happened to contrast with the accent fill. Now that
    /// `background` follows the system appearance, a CTA button needs its own fixed,
    /// always-dark foreground so "Start your first journey" doesn't render pale-on-pale in
    /// Light Mode. `accent` itself doesn't change between appearances, so neither does this.
    static let onAccent = Color.black

    // MARK: Backgrounds — system-provided, adapt automatically with light/dark.

    static let background = Color(uiColor: .systemBackground)
    static let surface = Color(uiColor: .secondarySystemBackground)
    static let surfaceRaised = Color(uiColor: .tertiarySystemBackground)
    /// A barely-there card/field tint over another surface — replaces a couple of hand-picked
    /// `.white.opacity(0.04...0.06)` fills that only read correctly on a fixed dark page.
    /// `.quaternarySystemFill` is the system's own answer to "a hair lighter/darker than
    /// what's underneath," and it already adapts to appearance and contrast on its own.
    static let fillSubtle = Color(uiColor: .quaternarySystemFill)

    // MARK: Text — semantic where the system has the answer, dynamic where it needed help.

    static let textPrimary = Color.primary
    /// `.secondary` already ships a correct dynamic value across light/dark; the gap was
    /// Increase Contrast, which this closes by stepping all the way to `.label` instead of
    /// staying at `.secondaryLabel` when the setting is on.
    static let textSecondary = Color(uiColor: UIColor { traits in
        traits.accessibilityContrast == .high ? .label : .secondaryLabel
    })
    /// The pre-rewrite version of this was 40% white AND ignored Increase Contrast at the same
    /// time — small text at low contrast is precisely the combination HIG flags as a problem.
    /// Increased contrast now lifts it to `textSecondary`'s own floor (`.secondaryLabel`), not
    /// just partway, so the "smallest and dimmest text in the app" stops being both at once.
    static let textTertiary = Color(uiColor: UIColor { traits in
        traits.accessibilityContrast == .high ? .secondaryLabel : .tertiaryLabel
    })
    /// Hairline borders thicken (in colour, since the width is set per call site) under
    /// Increase Contrast — a barely-there 8%-opacity separator is exactly the kind of edge
    /// that setting exists to strengthen.
    static let hairline = Color(uiColor: UIColor { traits in
        traits.accessibilityContrast == .high ? .separator : UIColor.separator.withAlphaComponent(0.5)
    })

    /// Inline problem text (a failed sharing change, say). A system colour now, so it inherits
    /// Apple's own light/dark tuning instead of a hand-picked amber that was only checked
    /// against one appearance.
    static let warning = Color(uiColor: .systemOrange)

    /// Subtle top-to-bottom gradient used behind hero areas — two adjacent system-background
    /// tiers instead of two navy values picked by eye against a dark canvas only.
    static let heroGradient = LinearGradient(
        colors: [Color(uiColor: .tertiarySystemBackground), Color(uiColor: .systemBackground)],
        startPoint: .top,
        endPoint: .bottom
    )
}

// MARK: - Adaptive colour (light/dark, same hue)

extension Color {
    /// The one place a colour that needs a DIFFERENT (not just system-provided) value between
    /// Light and Dark Mode gets resolved — same technique `Theme.textSecondary`/`hairline` above
    /// use for Increase Contrast (a dynamic `UIColor` closure the system re-resolves on every
    /// appearance change, no view code involved), just keyed on `userInterfaceStyle` instead of
    /// `accessibilityContrast`. Was written twice, independently, as private `UIColor { traits in
    /// … }` helpers in `StatsView` (`adaptiveHue`) and `DayContentConfig` (`dayColorAdaptive`) —
    /// both call through to this now instead.
    static func adaptive(dark: Color, light: Color) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
    }
}

// MARK: - Adaptive material

/// Frosted glass that becomes an opaque fill when Reduce Transparency is on — the one place
/// this swap happens, so the ~40 call sites that use `.ultraThinMaterial` don't each need their
/// own `@Environment(\.accessibilityReduceTransparency)` read. `opaqueFill` defaults to
/// `Theme.surface` for the app's own chrome; the map's overlays pass a fixed dark fill instead
/// (see `MapPalette.overlaySurface` and `mapOverlayMaterial`), because they sit on the
/// immersive map rather than on a light/dark-adapting page.
private struct AdaptiveMaterial<S: Shape>: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let shape: S
    let opaqueFill: Color

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(opaqueFill, in: shape)
        } else {
            content.background(.ultraThinMaterial, in: shape)
        }
    }
}

extension View {
    /// See `AdaptiveMaterial`. Use this instead of `.background(.ultraThinMaterial, in:)`
    /// anywhere a translucent surface needs to answer Reduce Transparency.
    func themedMaterial<S: Shape>(_ shape: S, opaqueFill: Color = Theme.surface) -> some View {
        modifier(AdaptiveMaterial(shape: shape, opaqueFill: opaqueFill))
    }
}

// MARK: - iPad reading width (D2)

/// Caps a screen's content to a comfortable reading width and centres it on iPad's regular
/// width class — a no-op in `.compact` (phone), where the screen is already narrower than the
/// cap, so the phone layout is unaffected by construction, not just by convention.
///
/// A 13" iPad is ~1000+ pt wide in portrait; letting a `Form` or a `ScrollView` of body text
/// stretch edge-to-edge across that is the single loudest "this is a stretched phone" signal in
/// the app, per D2's brief. Five screens share this one modifier (Stats, Settings, Paywall,
/// Onboarding, the journey story) instead of five hand-rolled `HStack { Spacer(); ...; Spacer() }`
/// blocks that would drift out of sync with each other over time.
private struct RegularWidthReadingPane: ViewModifier {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    let maxWidth: CGFloat

    func body(content: Content) -> some View {
        if horizontalSizeClass == .regular {
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                content.frame(maxWidth: maxWidth)
                Spacer(minLength: 0)
            }
        } else {
            content
        }
    }
}

extension View {
    /// See `RegularWidthReadingPane`. Apply to the screen's top-level content container (the
    /// `Form`, or the `VStack`/`ScrollView` content) — not to its background, so an immersive
    /// full-bleed background (a hero image, `Theme.background.ignoresSafeArea()`) stays edge to
    /// edge while the readable content centres over it.
    func constrainedReadingWidth(_ maxWidth: CGFloat = 640) -> some View {
        modifier(RegularWidthReadingPane(maxWidth: maxWidth))
    }
}

/// A rounded "surface" card container.
struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Theme.hairline, lineWidth: 1)
            )
    }
}

/// A small labelled stat pill (icon + value + caption).
/// A row of `StatChip`s that wraps instead of squeezing.
///
/// Four chips side by side on a 402 pt phone leaves ~45 pt for the number, and `Formatters.meters`
/// on a real summit is "5,895 m" — so Kilimanjaro's Summit chip rendered as "5,89…" even with
/// `minimumScaleFactor`.
///
/// The rule is **available width, not size class**. An earlier version keyed off
/// `horizontalSizeClass == .compact`, which is the same mistake in a different costume: the iPad's
/// day panel is a 400 pt column inside a *regular* width environment, so the row went back to one
/// line and truncated "3,963 m" to "3,9…" — the exact bug this type exists to prevent, now on the
/// device with the most room. `ViewThatFits` asks the only question that matters: does the single
/// row actually fit here?
struct StatChipRow: View {
    struct Item: Identifiable {
        var icon: String
        var value: String
        var caption: String
        var id: String { caption }
    }

    let items: [Item]
    var spacing: CGFloat = 10

    var body: some View {
        ViewThatFits(in: .horizontal) {
            singleRow
            twoColumns
        }
    }

    private var singleRow: some View {
        HStack(spacing: spacing) {
            ForEach(items) { chip in
                StatChip(icon: chip.icon, value: chip.value, caption: chip.caption)
            }
        }
    }

    private var twoColumns: some View {
        LazyVGrid(columns: [GridItem(spacing: spacing), GridItem(spacing: spacing)], spacing: spacing) {
            ForEach(items) { chip in
                StatChip(icon: chip.icon, value: chip.value, caption: chip.caption)
            }
        }
    }
}

struct StatChip: View {
    let icon: String
    let value: String
    let caption: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.caption2)
                    .foregroundStyle(Theme.accent)
                Text(value)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Text(caption)
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        // `minWidth` is what makes `StatChipRow`'s `ViewThatFits` work at all: with only
        // `maxWidth: .infinity` the single row is infinitely compressible, so it always "fits" and
        // the wrapping branch is never chosen — it just squeezes until the number truncates. The
        // minimum is the width a real value needs ("5,895 m" at `.subheadline`, plus the icon and
        // this padding), so "does one row fit?" becomes a question about the number rather than
        // about the container.
        .frame(minWidth: 96, maxWidth: .infinity, alignment: .leading)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
