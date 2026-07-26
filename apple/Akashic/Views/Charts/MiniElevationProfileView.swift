import SwiftUI

/// Compact elevation chart — the SwiftUI port of the web's `MiniElevationProfile.tsx`, drawn
/// with `Canvas` at the **100 × 48** logical space (padding top 8 / bottom 16).
///
/// Unlike the interactive chart, the mini normalises elevation against the **raw**
/// `minEle…maxEle` range (no 10 % padding), so it re-projects from each `ElevationProfileModel`
/// point's `dist`/`ele` rather than using the pre-baked 300 × 120 coordinates. Styling parallels
/// the web (colours adapted — see `ChartPalette`): an accent line over a `0.3 → 0` area,
/// per-camp drop lines (selected = solid accent, else dashed hairline), day dots (r2.5 /
/// selected r4) and day-number labels, with ≥32 pt invisible tap targets for touch.
///
/// Reusable: depends only on `ElevationProfileModel`. Selection is by `dayNumber`
/// (`selectedDay` + `onSelectDay`), matching the web's list/card usage.
struct MiniElevationProfileView: View {

    let model: ElevationProfileModel

    /// The selected day number (highlights that camp). `nil` = none.
    var selectedDay: Int?

    /// Called with a day number when its marker / tap target is tapped.
    var onSelectDay: ((Int) -> Void)?

    private let height: CGFloat = 48
    private let paddingTop: CGFloat = 8
    private let paddingBottom: CGFloat = 16
    private var chartHeight: CGFloat { height - paddingTop - paddingBottom }   // 24

    var body: some View {
        GeometryReader { geo in
            let size = CGSize(width: geo.size.width, height: height)
            ZStack(alignment: .topLeading) {
                Canvas { context, canvasSize in
                    draw(context: context, size: canvasSize)
                }
                // QUA-07: the `Canvas` is a bitmap to accessibility, and the invisible tap targets
                // over it are the only way to select a day here. They are the accessible content, so
                // the drawing is marked as decoration and the targets carry the labels — the
                // alternative (one summary element) would make a working control unreachable.
                .accessibilityHidden(true)
                tapTargets(size: size)
            }
        }
        .frame(height: height)
        .background(Theme.fillSubtle, in: RoundedRectangle(cornerRadius: 8))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        // A container, so VoiceOver announces what the group of day buttons belongs to before
        // walking them, and the summary is there even for a profile with no days to select.
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Elevation profile")
        .accessibilityValue(summary)
    }

    /// The same one-sentence shape `InteractiveElevationProfileView` gives, so the two charts describe
    /// one route identically. There is no `AXChartDescriptor` on the mini chart on purpose: it is a
    /// 48 pt strip inside a list row whose job is "which day do I want", and the day markers below are
    /// exactly that question made navigable. The full chart in the day sheet is where a reader who
    /// wants the profile itself goes, and that one has the Audio Graph.
    private var summary: Text {
        Text("\(Formatters.distanceKm(model.totalDist)), from \(Formatters.meters(Int(model.minEle.rounded()))) to \(Formatters.meters(Int(model.maxEle.rounded())))")
    }

    // MARK: - Projection (raw min/max, matching the web mini)

    private func sx(_ dist: Double, width: CGFloat) -> CGFloat {
        let distRange = model.totalDist > 0 ? model.totalDist : 1
        return CGFloat(dist / distRange) * width
    }

    private func sy(_ ele: Double) -> CGFloat {
        let eleRange = (model.maxEle - model.minEle) > 0 ? (model.maxEle - model.minEle) : 1
        return paddingTop + chartHeight - CGFloat((ele - model.minEle) / eleRange) * chartHeight
    }

    // MARK: - Drawing

    private func draw(context: GraphicsContext, size: CGSize) {
        guard model.points.count > 1 else { return }
        let w = size.width
        let pts = model.points.map { CGPoint(x: sx($0.dist, width: w), y: sy($0.ele)) }

        // Area fill.
        let baseY = paddingTop + chartHeight
        var area = Path()
        area.move(to: pts[0])
        for p in pts.dropFirst() { area.addLine(to: p) }
        area.addLine(to: CGPoint(x: pts.last!.x, y: baseY))
        area.addLine(to: CGPoint(x: pts.first!.x, y: baseY))
        area.closeSubpath()
        context.fill(area, with: .linearGradient(
            Gradient(colors: [ChartPalette.accent.opacity(0.3), ChartPalette.accent.opacity(0)]),
            startPoint: CGPoint(x: 0, y: paddingTop),
            endPoint: CGPoint(x: 0, y: baseY)))

        // Elevation line.
        var line = Path()
        line.move(to: pts[0])
        for p in pts.dropFirst() { line.addLine(to: p) }
        context.stroke(line, with: .color(ChartPalette.accent.opacity(0.6)),
                       style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))

        // Camp markers.
        for marker in model.campMarkers {
            let isSelected = marker.dayNumber == selectedDay
            let x = sx(marker.dist, width: w)
            let y = sy(marker.ele)

            // Vertical drop line to the baseline.
            var drop = Path()
            drop.move(to: CGPoint(x: x, y: y))
            drop.addLine(to: CGPoint(x: x, y: height - 4))
            if isSelected {
                context.stroke(drop, with: .color(ChartPalette.accent), lineWidth: 1.5)
            } else {
                context.stroke(drop, with: .color(Theme.hairline),
                               style: StrokeStyle(lineWidth: 0.5, dash: [2, 2]))
            }

            // Dot. Ring is a page-background keyline (`ChartPalette.dotRing`), not a fixed white.
            let r: CGFloat = isSelected ? 4 : 2.5
            let dotRect = CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)
            let dot = Path(ellipseIn: dotRect)
            context.fill(dot, with: .color(isSelected ? ChartPalette.accent : ChartPalette.line.opacity(0.5)))
            if isSelected {
                context.stroke(dot, with: .color(ChartPalette.dotRing), lineWidth: 1)
            }

            // Day-number label.
            var label = Text("\(marker.dayNumber)").font(.system(size: 7, weight: isSelected ? .semibold : .regular))
            label = label.foregroundColor(isSelected ? Theme.textPrimary : Theme.textTertiary)
            context.draw(label, at: CGPoint(x: x, y: height - 2), anchor: .center)
        }
    }

    // MARK: - Tap targets (≥32 pt wide, matching the web overlay)

    @ViewBuilder
    private func tapTargets(size: CGSize) -> some View {
        ForEach(model.campMarkers) { marker in
            let x = sx(marker.dist, width: size.width)
            Color.clear
                .contentShape(Rectangle())
                .frame(width: 32, height: 24)
                .position(x: min(max(x, 16), size.width - 16), y: height - 12)
                .onTapGesture { onSelectDay?(marker.dayNumber) }
                // QUA-07: a `Color.clear` with an `onTapGesture` is not a control to VoiceOver — no
                // element, no label, no button trait — so selecting a day from this chart was
                // impossible. Each target now carries the day it selects, where it falls on the route,
                // and how high it is, which is the information the visible dot conveys by position.
                .accessibilityElement()
                .accessibilityLabel(Text("Day \(marker.dayNumber), \(marker.name), \(Formatters.distanceKm(marker.dist)) into the route, \(Formatters.meters(Int(marker.ele.rounded())))"))
                .accessibilityAddTraits(marker.dayNumber == selectedDay ? [.isButton, .isSelected] : .isButton)
        }
    }

}

#Preview {
    let journey = try! FixtureLoader.load(named: "kilimanjaro", bundle: .main)
    return MiniElevationProfileView(model: ElevationProfileModel(journey: journey)!, selectedDay: 3)
        .padding()
        .frame(width: 320)
        .background(Theme.background)
        .preferredColorScheme(.dark)
}
