import SwiftUI

/// The widget's presentation layer, driven entirely by a `WidgetSnapshot`.
///
/// Kept free of any WidgetKit dependency (it takes an explicit `WidgetSizeClass` instead of the
/// `\.widgetFamily` environment) so it can be compiled into BOTH the `AkashicWidgets` target
/// and the app target — the latter re-uses it for the screenshot harness
/// (`WidgetGalleryHarness`). The WidgetKit glue (timeline provider, `Widget` configuration,
/// `@main` bundle) lives in the widget-only `JourneyStatsWidget.swift`.

/// Which widget size we are rendering (a WidgetKit-free stand-in for `WidgetFamily`).
enum WidgetSizeClass {
    case small
    case medium
}

/// Self-contained palette for the widget — it must NOT depend on the app's `Theme` (which
/// lives in the sibling-owned `Views/` and is not part of the widget target).
enum WidgetTheme {
    static let background = LinearGradient(
        colors: [Color(red: 0.05, green: 0.07, blue: 0.14),
                 Color(red: 0.02, green: 0.03, blue: 0.08)],
        startPoint: .topLeading, endPoint: .bottomTrailing)
    static let accent = Color(red: 0.36, green: 0.82, blue: 0.96)      // cyan (matches map segment)
    static let amber = Color(red: 1.0, green: 0.75, blue: 0.32)
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.62)
    static let hairline = Color.white.opacity(0.12)
}

struct JourneyStatsWidgetView: View {
    let snapshot: WidgetSnapshot
    let size: WidgetSizeClass

    var body: some View {
        switch size {
        case .small: small
        case .medium: medium
        }
    }

    // MARK: Small — name + flag + km / days / summit

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 3) {
                statRow(icon: "point.topleft.down.curvedto.point.bottomright.up",
                        value: snapshot.distanceText)
                statRow(icon: "calendar", value: snapshot.daysText)
                if let summit = snapshot.summitText {
                    statRow(icon: "mountain.2.fill", value: summit)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Medium — small content + a mini stats row and an elevation sparkline

    private var medium: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                header
                Spacer(minLength: 0)
                HStack(spacing: 16) {
                    miniStat(snapshot.distanceText, label: "distance")
                    miniStat("\(snapshot.days)", label: snapshot.days == 1 ? "day" : "days")
                    if let summit = snapshot.summitText {
                        miniStat(summit, label: "summit")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 6) {
                Text("ELEVATION")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1.5)
                    .foregroundStyle(WidgetTheme.textSecondary)
                ElevationSparkline(samples: snapshot.elevationSamples)
                    .frame(width: 130, height: 66)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 8) {
            Text(snapshot.flag)
                .font(.system(size: 24))
            VStack(alignment: .leading, spacing: 1) {
                Text(snapshot.name)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(WidgetTheme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(snapshot.country)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(WidgetTheme.textSecondary)
                    .lineLimit(1)
            }
        }
    }

    private func statRow(icon: String, value: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(WidgetTheme.accent)
                .frame(width: 14)
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(WidgetTheme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private func miniStat(_ value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(WidgetTheme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label.uppercased())
                .font(.system(size: 8, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(WidgetTheme.textSecondary)
        }
    }
}

/// A tiny self-contained elevation profile drawn from the snapshot's sampled points — a filled
/// area under a stroked line, normalised to the sample min/max. No external chart dependency.
struct ElevationSparkline: View {
    let samples: [Double]

    var body: some View {
        GeometryReader { geo in
            let points = normalized(in: geo.size)
            ZStack {
                if points.count > 1 {
                    // Filled area under the line.
                    Path { path in
                        path.move(to: CGPoint(x: points[0].x, y: geo.size.height))
                        for point in points { path.addLine(to: point) }
                        path.addLine(to: CGPoint(x: points[points.count - 1].x, y: geo.size.height))
                        path.closeSubpath()
                    }
                    .fill(LinearGradient(
                        colors: [WidgetTheme.accent.opacity(0.35), WidgetTheme.accent.opacity(0.02)],
                        startPoint: .top, endPoint: .bottom))

                    // The elevation line itself.
                    Path { path in
                        path.move(to: points[0])
                        for point in points.dropFirst() { path.addLine(to: point) }
                    }
                    .stroke(WidgetTheme.accent,
                            style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                } else {
                    // No elevation data — a flat hairline baseline.
                    Path { path in
                        path.move(to: CGPoint(x: 0, y: geo.size.height / 2))
                        path.addLine(to: CGPoint(x: geo.size.width, y: geo.size.height / 2))
                    }
                    .stroke(WidgetTheme.hairline, lineWidth: 1)
                }
            }
        }
    }

    private func normalized(in size: CGSize) -> [CGPoint] {
        guard samples.count > 1 else { return [] }
        let minValue = samples.min() ?? 0
        let maxValue = samples.max() ?? 1
        let range = max(maxValue - minValue, 1)
        let inset: CGFloat = 3   // keep the 2pt stroke inside the frame
        let usableHeight = size.height - inset * 2
        return samples.enumerated().map { index, value in
            let x = size.width * CGFloat(index) / CGFloat(samples.count - 1)
            let y = inset + usableHeight * (1 - CGFloat((value - minValue) / range))
            return CGPoint(x: x, y: y)
        }
    }
}

/// The bundled placeholder snapshot, used for widget previews / redacted placeholders and as
/// the fallback whenever the shared container has no real data yet (i.e. tonight). Loaded from
/// `placeholder-snapshot.json` in the widget bundle, with a hard-coded fallback so a preview
/// always renders even if the resource is missing.
enum WidgetPlaceholder {
    static let snapshot: WidgetSnapshot = load()

    private static func load() -> WidgetSnapshot {
        if let url = Bundle.main.url(forResource: "placeholder-snapshot", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) {
            return decoded
        }
        return WidgetSnapshot(
            id: "kilimanjaro", name: "Kilimanjaro", country: "Tanzania", flag: "🇹🇿",
            distanceKm: 70, days: 7, summitElevation: 5895, summitName: "Uhuru Peak",
            elevationSamples: [1800, 2100, 2700, 3500, 3900, 4600, 4050, 4700, 5895, 3100, 1800],
            thumbnailPath: nil,
            distanceText: "70 km", daysText: "7 days", summitText: "5,895 m")
    }
}
