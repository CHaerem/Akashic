import SwiftUI

// MARK: - Color helpers

extension Color {
    init(hex: String, alpha: Double = 1) {
        var s = hex
        if s.hasPrefix("#") { s.removeFirst() }
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        let r = Double((v & 0xFF0000) >> 16) / 255
        let g = Double((v & 0x00FF00) >> 8) / 255
        let b = Double(v & 0x0000FF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}

enum Palette {
    static let nightSky = Color(hex: "0B0B19")          // rgb(11,11,25)
    static let cyan = Color(hex: "00FFFF")              // active segment
    static let routeWhite = Color.white
    // amber camp family (spec 2d)
    static let campFillDefault = Color(.sRGB, red: 254/255, green: 249/255, blue: 235/255, opacity: 0.95)
    static let campFillSelected = Color(.sRGB, red: 254/255, green: 243/255, blue: 199/255, opacity: 1)
    static let campStrokeDefault = Color(.sRGB, red: 253/255, green: 211/255, blue: 106/255, opacity: 0.9)
    static let campStrokeSelected = Color(.sRGB, red: 251/255, green: 191/255, blue: 36/255, opacity: 1)
    static let campGlow = Color(.sRGB, red: 251/255, green: 191/255, blue: 36/255, opacity: 0.8)
    static let campTextDefault = Color(.sRGB, red: 146/255, green: 64/255, blue: 14/255, opacity: 1)
    static let campTextSelected = Color(.sRGB, red: 120/255, green: 53/255, blue: 15/255, opacity: 1)
}

// MARK: - Seeded starfield backdrop (spec 2f)
// MapKit renders its own opaque space at globe distance, so this backdrop is
// mostly occluded — see README. Kept for correctness / edge-fade parity.

struct StarfieldView: View {
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
                ? Color(.sRGB, red: 180/255, green: 200/255, blue: 1, opacity: 1)
                : (tintRoll < 0.05 ? Color(.sRGB, red: 1, green: 210/255, blue: 170/255, opacity: 1) : .white)
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
        .background(Palette.nightSky)
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

// MARK: - Journey pin (globe marker, spec 2c)

struct JourneyPin: View {
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
        .accessibilityLabel("Journey pin")
    }
}

// MARK: - Camp badge (amber day-number, spec 2d)

struct CampBadge: View {
    let day: Int
    let selected: Bool

    var body: some View {
        ZStack {
            Circle()
                .fill(Palette.campGlow.opacity(selected ? 0.8 : 0.45))
                .frame(width: selected ? 34 : 26, height: selected ? 34 : 26)
                .blur(radius: 4)
            Circle()
                .fill(selected ? Palette.campFillSelected : Palette.campFillDefault)
                .frame(width: selected ? 26 : 20, height: selected ? 26 : 20)
                .overlay(
                    Circle().stroke(selected ? Palette.campStrokeSelected : Palette.campStrokeDefault,
                                    lineWidth: selected ? 2 : 1.5)
                )
            Text("\(day)")
                .font(.system(size: selected ? 13 : 10, weight: .bold, design: .rounded))
                .foregroundStyle(selected ? Palette.campTextSelected : Palette.campTextDefault)
        }
        .accessibilityLabel("Day \(day) camp")
    }
}

// MARK: - HUD (A/B judgment aid)

struct HUDView: View {
    let readout: CameraReadout
    let stage: Stage
    let styleMode: MapStyleMode
    let isRotating: Bool

    private var stageLabel: String {
        switch stage {
        case .globe: return "GLOBE"
        case .overview: return "OVERVIEW"
        case let .day(i): return "DAY \(i + 1)"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(stageLabel).fontWeight(.bold)
                if isRotating { Text("· spin").foregroundStyle(.cyan) }
            }
            Text(String(format: "lat %.4f  lon %.4f", readout.lat, readout.lon))
            Text(String(format: "dist %@  pitch %.0f°  head %.0f°",
                        Self.fmtDistance(readout.distance), readout.pitch, readout.heading))
            Text("style: \(styleMode.rawValue)")
        }
        .font(.system(size: 11, weight: .regular, design: .monospaced))
        .foregroundStyle(.white)
        .padding(8)
        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 8))
    }

    static func fmtDistance(_ m: Double) -> String {
        if m >= 1_000_000 { return String(format: "%.0fMm", m / 1_000_000) }
        if m >= 1_000 { return String(format: "%.1fkm", m / 1_000) }
        return String(format: "%.0fm", m)
    }
}
