import SwiftUI
import CoreLocation

// MARK: - Map palette (spec §2)
//
// The map's own colour language, distinct from `Theme` (which styles the surrounding
// chrome). Kept local to the map so the signature route/segment/camp colours stay in
// one place. `nightSky` is fixed at #0B0B19 (rgb(11,11,25)) in every appearance — it is
// deliberately NOT the same as `Theme.background` (now adaptive, `.systemBackground`):
// the whole point of a dedicated map palette is that the globe/trek map stays immersive
// night-sky dark regardless of Light/Dark Mode (see the A1/A3 note below), so this colour
// must NOT track `Theme.background` as it changes with the system appearance.

enum MapPalette {
    static let nightSky = Color(red: 11 / 255, green: 11 / 255, blue: 25 / 255) // #0B0B19
    static let cyan = Color(red: 0, green: 1, blue: 1)                          // #00FFFF active segment
    static let routeWhite = Color.white

    // MARK: On-map chrome (A1/A3)
    //
    // The globe and trek map stay visually immersive in BOTH appearances — bright satellite
    // imagery with light glass overlays is exactly what Apple Maps and the Photos viewer do,
    // not a light-mode bug to fix. So the map's own chrome (top bar, journey strip, day
    // navigator) reads its text/hairlines from here, fixed-light, instead of from `Theme`'s
    // adaptive `textPrimary`/`textSecondary`/`hairline` — those would go near-black in Light
    // Mode and disappear into the imagery they're drawn over.
    //
    // Increase Contrast still applies (unlike the light/dark swap, which deliberately does
    // not): these use the same dynamic-`UIColor` trick as `Theme` so the map's overlays answer
    // that setting too, exactly as A1 requires.
    static let label = Color.white
    static let labelSecondary = Color(uiColor: UIColor { traits in
        traits.accessibilityContrast == .high ? .white : UIColor.white.withAlphaComponent(0.7)
    })
    static let hairline = Color(uiColor: UIColor { traits in
        traits.accessibilityContrast == .high
            ? UIColor.white.withAlphaComponent(0.6)
            : UIColor.white.withAlphaComponent(0.18)
    })
    /// Opaque fallback for map-overlay glass under Reduce Transparency — stays night-sky dark
    /// in every appearance (matching the map itself) rather than following `Theme.surface`,
    /// which would go pale in Light Mode and stop reading as "glass over a dark map".
    static let overlaySurface = Color(.sRGB, red: 26 / 255, green: 28 / 255, blue: 52 / 255, opacity: 0.96)

    // Amber camp family (spec §2d).
    static let campFillDefault = Color(.sRGB, red: 254 / 255, green: 249 / 255, blue: 235 / 255, opacity: 0.95)
    static let campFillSelected = Color(.sRGB, red: 254 / 255, green: 243 / 255, blue: 199 / 255, opacity: 1)
    static let campStrokeDefault = Color(.sRGB, red: 253 / 255, green: 211 / 255, blue: 106 / 255, opacity: 0.9)
    static let campStrokeSelected = Color(.sRGB, red: 251 / 255, green: 191 / 255, blue: 36 / 255, opacity: 1)
    static let campGlow = Color(.sRGB, red: 251 / 255, green: 191 / 255, blue: 36 / 255, opacity: 0.8)
    static let campTextDefault = Color(.sRGB, red: 146 / 255, green: 64 / 255, blue: 14 / 255, opacity: 1)
    static let campTextSelected = Color(.sRGB, red: 120 / 255, green: 53 / 255, blue: 15 / 255, opacity: 1)

    // Photo thumbnail marker (spec §2e — cool blue-white).
    static let photoStroke = Color(.sRGB, red: 96 / 255, green: 165 / 255, blue: 250 / 255, opacity: 0.9)
}

extension View {
    /// The map's own answer to Reduce Transparency: `.ultraThinMaterial` normally, an opaque
    /// `MapPalette.overlaySurface` fill when the setting is on. A parallel to `Theme`'s
    /// `themedMaterial` with a fixed dark fallback instead of an appearance-adaptive one — see
    /// the note on `MapPalette`'s on-map chrome colours for why.
    func mapOverlayMaterial<S: Shape>(_ shape: S) -> some View {
        themedMaterial(shape, opaqueFill: MapPalette.overlaySurface)
    }
}

// MARK: - Photo marker hook
//
// Minimal, self-contained photo type so the globe map can render optional thumbnail
// markers WITHOUT depending on the Import / photo agent's Core Data `CDPhoto` work.
// `GlobeExperienceView(photos:)` takes `[MapPhoto]` defaulting to empty; the other
// agent can map their photos into this and pass them in later without touching this file.

struct MapPhoto: Identifiable, Equatable {
    let id: String
    let latitude: Double
    let longitude: Double
    /// Optional day this photo belongs to (used to show only the selected day's photos).
    var dayNumber: Int?
    /// Optional local/remote thumbnail; a placeholder glyph is shown when nil.
    var thumbnailURL: URL?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

// MARK: - Seeded starfield backdrop (spec §2f)
//
// MapKit paints its own opaque space + stars at globe distance, so this backdrop is
// mostly occluded (see the spike README). Kept for the globe-edge fade to #0B0B19 and
// so the app never flashes a white frame before the map draws.

struct MapStarfieldView: View {
    struct Star { let x: Double; let y: Double; let r: Double; let a: Double; let tint: Color }

    private let stars: [Star]

    init(count: Int = 160) {
        var rng = SeededRNG(seed: 42)
        var s: [Star] = []
        for _ in 0..<count {
            let x = Double.random(in: 0...1, using: &rng)
            let y = Double.random(in: 0...1, using: &rng)
            let tier = Double.random(in: 0...1, using: &rng)
            let r = tier > 0.97 ? 1.8 : (tier > 0.85 ? 1.3 : 0.8)
            let a = tier > 0.97 ? 0.95 : (tier > 0.6 ? 0.6 : 0.3)
            let tintRoll = Double.random(in: 0...1, using: &rng)
            let tint: Color = tintRoll > 0.94
                ? Color(.sRGB, red: 180 / 255, green: 200 / 255, blue: 1, opacity: 1)
                : (tintRoll < 0.05 ? Color(.sRGB, red: 1, green: 210 / 255, blue: 170 / 255, opacity: 1) : .white)
            s.append(Star(x: x, y: y, r: r, a: a, tint: tint))
        }
        stars = s
    }

    var body: some View {
        GeometryReader { geo in
            Canvas { ctx, size in
                for star in stars {
                    let rect = CGRect(x: star.x * size.width, y: star.y * size.height,
                                      width: star.r * 2, height: star.r * 2)
                    ctx.fill(Path(ellipseIn: rect), with: .color(star.tint.opacity(star.a)))
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .background(MapPalette.nightSky)
        .ignoresSafeArea()
    }
}

/// Tiny deterministic RNG so the starfield is stable across launches.
struct SeededRNG: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed == 0 ? 0x9E3779B97F4A7C15 : seed }
    mutating func next() -> UInt64 {
        state ^= state << 13
        state ^= state >> 7
        state ^= state << 17
        return state
    }
}

// MARK: - Journey pin (globe marker, spec §2c)

/// White glassy dot + glow used for each journey on the globe.
struct JourneyPin: View {
    /// Announced name — VoiceOver used to hear "Journey pin" for every pin on the globe,
    /// indistinguishable with more than one journey. Defaults for callers that don't (yet)
    /// thread a name through.
    var name: String = "Journey"

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.25))
                .frame(width: 24, height: 24)
                .blur(radius: 4)
            Circle()
                .fill(Color.white.opacity(0.92))
                .frame(width: 12, height: 12)
                .overlay(Circle().stroke(Color.white.opacity(0.35), lineWidth: 1))
                .shadow(color: .white.opacity(0.8), radius: 6)
        }
        // The drawn dot is 24 pt; this only widens the tappable box to the 44 pt minimum.
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityLabel(name)
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Camp badge (amber day-number, spec §2d)

/// Amber day-number badge; the selected day is bigger and brighter.
struct CampBadge: View {
    let day: Int
    let selected: Bool

    /// Every day this badge stands for when coincident camps merged into one (QUA-83), in day
    /// order. Empty or single-element for an ordinary camp; `day` is whichever of them the badge
    /// currently reads as. A rest day used to draw two badges exactly on top of each other, where
    /// only the later-declared one could be tapped.
    var mergedDays: [Int] = []

    /// The camp index this badge selects — the identifier's disambiguator (QUA-91). Two camps can
    /// carry the same day number, so day alone does not identify a badge.
    var dayIndex: Int = 0

    // The circles were sized to fit fixed 10/13 pt digits; scale them with the text so a
    // two-digit day number (day 10+) doesn't outgrow its badge at larger text sizes.
    @ScaledMetric(relativeTo: .caption2) private var glowDiameter: CGFloat = 26
    @ScaledMetric(relativeTo: .caption2) private var glowDiameterSelected: CGFloat = 34
    @ScaledMetric(relativeTo: .caption2) private var fillDiameter: CGFloat = 20
    @ScaledMetric(relativeTo: .caption2) private var fillDiameterSelected: CGFloat = 26

    var body: some View {
        ZStack {
            Circle()
                .fill(MapPalette.campGlow.opacity(selected ? 0.8 : 0.45))
                .frame(width: selected ? glowDiameterSelected : glowDiameter,
                       height: selected ? glowDiameterSelected : glowDiameter)
                .blur(radius: 4)
            Circle()
                .fill(selected ? MapPalette.campFillSelected : MapPalette.campFillDefault)
                .frame(width: selected ? fillDiameterSelected : fillDiameter,
                       height: selected ? fillDiameterSelected : fillDiameter)
                .overlay(
                    Circle().stroke(selected ? MapPalette.campStrokeSelected : MapPalette.campStrokeDefault,
                                    lineWidth: selected ? 2 : 1.5)
                )
            // 13/10 pt map to `.caption`/`.caption2` — `.caption` keeps the selected badge's
            // documented "bigger and brighter" emphasis without dropping below the floor.
            Text("\(day)")
                .font(.system(selected ? .caption : .caption2, design: .rounded).weight(.bold))
                .foregroundStyle(selected ? MapPalette.campTextSelected : MapPalette.campTextDefault)
        }
        .overlay(alignment: .topTrailing) {
            if mergedDays.count > 1 {
                MarkerCountChip(count: mergedDays.count)
                    .offset(x: 6, y: -6)
            }
        }
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
        // The single-day key is kept exactly as it was so the catalogue does not churn; the merged
        // case is a separate key with a locale-formatted list, because "2 and 3" is "2 og 3" in
        // Norwegian and joining it by hand in Swift would ship an English conjunction everywhere.
        .accessibilityLabel(mergedDays.count > 1
            ? Text("Camp for days \(mergedDays.map(String.init).formatted(.list(type: .and)))")
            : Text("Day \(day) camp"))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        // QUA-90. Applied here rather than at the call site so a whole-file revert of
        // `GlobeExperienceView` (which is how the tap-precedence guard is proven) restores the old
        // declaration order WITHOUT also removing the identifier the test needs to find this badge.
        .accessibilityIdentifier(A11yID.mapCampBadge(days: mergedDays.isEmpty ? [day] : mergedDays,
                                                    firstIndex: dayIndex))
    }
}

// MARK: - Marker count chip (QUA-83)

/// The small dark count chip a clustered photo stack or a merged camp badge carries.
///
/// Shared by both so the two "this marker stands for several things" surfaces read identically —
/// the web's stacks made the same choice with their count badge.
struct MarkerCountChip: View {
    let count: Int

    @ScaledMetric(relativeTo: .caption2) private var diameter: CGFloat = 16

    var body: some View {
        Text("\(count)")
            .font(.system(.caption2, design: .rounded).weight(.bold))
            .foregroundStyle(.white)
            .frame(minWidth: diameter, minHeight: diameter)
            .background(Circle().fill(Color.black.opacity(0.75)))
            .overlay(Circle().stroke(Color.white.opacity(0.6), lineWidth: 1))
            // Decorative: the count is already spoken by the owning marker's own label, and a
            // second element here would make VoiceOver read every stack twice.
            .accessibilityHidden(true)
    }
}

// MARK: - Photo thumbnail marker (spec §2e)

/// Cool blue-white thumbnail card for an on-route photo. Async-loads the thumbnail when a
/// URL is present, otherwise shows a camera glyph placeholder.
struct PhotoMarker: View {
    let photo: MapPhoto

    /// How many photos the marker stands for once clustered (QUA-83). 1 draws no chip.
    var count: Int = 1

    // The card was sized to fit a fixed 12 pt glyph; scale it with `.caption` so the
    // placeholder icon/thumbnail isn't left cramped in an undersized frame.
    @ScaledMetric(relativeTo: .caption) private var markerSize: CGFloat = 30
    @ScaledMetric(relativeTo: .caption) private var thumbnailSize: CGFloat = 24
    // This card fills a shape directly (`.fill`, not `.background(_, in:)`), so it can't ride
    // `mapOverlayMaterial` — same Reduce Transparency swap, applied by hand.
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(reduceTransparency ? AnyShapeStyle(MapPalette.overlaySurface) : AnyShapeStyle(.ultraThinMaterial))
                .frame(width: markerSize, height: markerSize)
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .strokeBorder(MapPalette.photoStroke, lineWidth: 1.5)
                )
                .shadow(color: .black.opacity(0.3), radius: 3, y: 1)

            if let url = photo.thumbnailURL {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "photo").font(.caption).foregroundStyle(.white.opacity(0.7))
                }
                .frame(width: thumbnailSize, height: thumbnailSize)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            } else {
                Image(systemName: "camera.fill")
                    .font(.caption)
                    .foregroundStyle(MapPalette.photoStroke)
            }
        }
        .overlay(alignment: .topTrailing) {
            if count > 1 {
                MarkerCountChip(count: count)
                    .offset(x: 6, y: -6)
            }
        }
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
        // Four keys rather than a composed string: the single-photo pair is kept verbatim so the
        // catalogue does not churn, and a stack says how many it holds, since "Photo" on a marker
        // that opens twelve of them is the wrong promise.
        .accessibilityLabel(photoLabel)
        .accessibilityAddTraits(.isButton)
        // QUA-90 — see the note on `CampBadge`'s identifier for why this lives here.
        .accessibilityIdentifier(A11yID.mapPhotoStack(photoID: photo.id))
    }

    private var photoLabel: Text {
        switch (photo.dayNumber, count > 1) {
        case let (day?, true):  return Text("\(count) photos, day \(day)")
        case (nil, true):       return Text("\(count) photos")
        case let (day?, false): return Text("Photo, day \(day)")
        case (nil, false):      return Text("Photo")
        }
    }
}
