import SwiftUI
import CoreLocation

// MARK: - Map palette (spec §2)
//
// The map's own colour language, distinct from `Theme` (which styles the surrounding
// chrome). Kept local to the map so the signature route/segment/camp colours stay in
// one place. Space colour matches `Theme.background` (#0B0B19 / rgb(11,11,25)).

enum MapPalette {
    static let nightSky = Color(red: 11 / 255, green: 11 / 255, blue: 25 / 255) // #0B0B19
    static let cyan = Color(red: 0, green: 1, blue: 1)                          // #00FFFF active segment
    static let routeWhite = Color.white

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
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityLabel("Day \(day) camp")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Photo thumbnail marker (spec §2e)

/// Cool blue-white thumbnail card for an on-route photo. Async-loads the thumbnail when a
/// URL is present, otherwise shows a camera glyph placeholder.
struct PhotoMarker: View {
    let photo: MapPhoto

    // The card was sized to fit a fixed 12 pt glyph; scale it with `.caption` so the
    // placeholder icon/thumbnail isn't left cramped in an undersized frame.
    @ScaledMetric(relativeTo: .caption) private var markerSize: CGFloat = 30
    @ScaledMetric(relativeTo: .caption) private var thumbnailSize: CGFloat = 24

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(.ultraThinMaterial)
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
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityLabel(photo.dayNumber.map { "Photo, day \($0)" } ?? "Photo")
        .accessibilityAddTraits(.isButton)
    }
}
