import SwiftUI
import Accessibility

/// Full interactive elevation chart — the SwiftUI port of the web's
/// `InteractiveElevationProfile.tsx`, drawn with `Canvas` at the same **300 × 120** logical
/// space (see `ElevationProfileModel`).
///
/// Visuals (parity with the web SVG, colours adapted — see `ChartPalette`):
///   * adaptive 1.5 pt line over a matching `0.15 → 0` vertical gradient area,
///   * a selected-day overlay (`ChartPalette.accent` area `0.3 → 0` + `0.6` line) up to the
///     selected camp's x,
///   * camp dots r4 (selected r5) with a halo ring when selected/hovered, plus `D{n}` labels,
///   * a dashed crosshair + a dot with a `{dist} km · {ele} m` (or camp-name) tooltip.
///
/// Interaction: pinch to zoom `1×…4×` (anchored at the pinch), horizontal pan when zoomed,
/// drag to scrub the crosshair (when un-zoomed), and tap a camp dot to select its day.
///
/// Reusable: this view depends only on `ElevationProfileModel`, so the day sheet and widgets
/// can adopt it. Selection is expressed via `selectedCampID` + the `onSelectCamp` callback
/// (which hands back the tapped `CampMarker`, carrying both `campID` and `dayNumber`).
struct InteractiveElevationProfileView: View {

    let model: ElevationProfileModel

    /// The currently selected camp (drives the blue overlay + dot highlight). `nil` = none.
    var selectedCampID: String?

    /// Called with the tapped camp marker when a camp dot is selected.
    var onSelectCamp: ((ElevationProfileModel.CampMarker) -> Void)?

    /// Total chart height in points (includes headroom for the `D{n}` labels above the line).
    var chartHeight: CGFloat = 156

    /// Debug/deep-link seam (used by screenshot hooks): initial zoom, pan and crosshair so a
    /// zoomed + scrubbed state can be captured deterministically. Not needed for normal use.
    var initialZoom: CGFloat = 1
    var initialCrosshairLogicalX: CGFloat?

    // Zoom limits (web: MIN_ZOOM / MAX_ZOOM).
    private let minZoom: CGFloat = 1
    private let maxZoom: CGFloat = 4
    /// Room above the 0…120 plot for the `D{n}` labels / hover dot (web relies on overflow).
    private let topInset: CGFloat = 24
    /// Horizontal breathing room so the first/last camp dots and `D{n}` labels aren't clipped.
    private let hInset: CGFloat = 12

    // MARK: - Interaction state

    @State private var zoom: CGFloat = 1
    @State private var originX: CGFloat = 0          // logical left edge of the view window (0…300)
    @State private var hover: Hover?
    @State private var didApplyInitialState = false

    // Gesture baselines captured at gesture start.
    @State private var pinchBaseZoom: CGFloat?
    @State private var pinchBaseOrigin: CGFloat?
    @State private var dragBaseOrigin: CGFloat?

    private struct Hover: Equatable {
        var logicalX: CGFloat
        var logicalY: CGFloat
        var dist: Double
        var ele: Double
        var campName: String?
    }

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            chart
            axisLabels
            Text(hint)
                .font(.system(size: 9))
                .foregroundStyle(Theme.textTertiary)
                .frame(maxWidth: .infinity, alignment: .center)
                // Three gestures none of which a VoiceOver user performs — pinch, scrub and tapping a
                // dot are all sighted, direct-manipulation affordances. The chart's own hint points at
                // Audio Graph, which is the equivalent that does work.
                .accessibilityHidden(true)
        }
        .onAppear(perform: applyInitialStateIfNeeded)
    }

    private var chart: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack(alignment: .topLeading) {
                Canvas { context, canvasSize in
                    draw(context: context, size: canvasSize)
                }
                .contentShape(Rectangle())
                .gesture(dragGesture(size: size))
                .simultaneousGesture(tapGesture(size: size))
                .simultaneousGesture(magnifyGesture(size: size))
                // QUA-07: a hand-rolled `Canvas` is a bitmap as far as accessibility is concerned —
                // this chart, the most distinctive thing in the app, was entirely silent. It gets a
                // real `AXChartDescriptor` rather than a summary sentence, so VoiceOver's Audio Graph
                // can be opened on it and the profile explored point by point (and played as sound).
                // The summary label below is what is announced before that, so focusing the chart
                // still states the shape in words for someone who does not use Audio Graph.
                .accessibilityElement()
                .accessibilityLabel("Elevation profile")
                .accessibilityValue(summary)
                .accessibilityHint("Open Audio Graph from the VoiceOver rotor to explore the route point by point")
                .accessibilityChartDescriptor(self)

                tooltip(size: size)
                resetButton
            }
        }
        .frame(height: chartHeight)
    }

    /// The chart in one sentence: how far, between what elevations, over how many days. Everything
    /// here is already on screen as axis labels and `D{n}` markers — this is the same information
    /// read in an order that makes sense aloud.
    private var summary: Text {
        Text("\(Formatters.distanceKm(model.totalDist)), from \(Formatters.meters(Int(model.minEle.rounded()))) to \(Formatters.meters(Int(model.maxEle.rounded()))), with \(model.campMarkers.count) days marked")
    }

    // MARK: - Coordinate mapping

    private func viewWidth() -> CGFloat { Self.logicalWidth / zoom }

    private func screenX(_ logicalX: CGFloat, size: CGSize) -> CGFloat {
        let drawable = max(size.width - hInset * 2, 1)
        return hInset + (logicalX - originX) / viewWidth() * drawable
    }

    private func screenY(_ logicalY: CGFloat, size: CGSize) -> CGFloat {
        let plotH = size.height - topInset
        return topInset + logicalY / Self.logicalHeight * plotH
    }

    /// Screen x → logical x within the current zoom/pan window.
    private func logicalX(fromScreenX x: CGFloat, size: CGSize) -> CGFloat {
        let drawable = max(size.width - hInset * 2, 1)
        return originX + ((x - hInset) / drawable) * viewWidth()
    }

    // MARK: - Drawing

    private func draw(context: GraphicsContext, size: CGSize) {
        guard model.points.count > 1 else { return }
        let sx: (CGFloat) -> CGFloat = { screenX($0, size: size) }
        let sy: (CGFloat) -> CGFloat = { screenY($0, size: size) }

        // Grid lines at logical y 0 / 60 / 120.
        for gy in [CGFloat(0), 60, 120] {
            var line = Path()
            line.move(to: CGPoint(x: 0, y: sy(gy)))
            line.addLine(to: CGPoint(x: size.width, y: sy(gy)))
            context.stroke(line, with: .color(Theme.hairline), lineWidth: 1)
        }

        // Elevation line + area — `ChartPalette.line` inverts black/white with the appearance
        // (was a literal `.white` stroke/fill, invisible once this screen stopped being forced
        // dark: see `ChartPalette`'s doc comment).
        let linePath = pathThrough(model.points.map { CGPoint(x: sx($0.x), y: sy($0.y)) })
        let baseY = sy(Self.logicalHeight)
        let areaPath = closedArea(from: model.points.map { CGPoint(x: sx($0.x), y: sy($0.y)) },
                                  baseY: baseY)
        context.fill(areaPath, with: .linearGradient(
            Gradient(colors: [ChartPalette.areaFillTop, ChartPalette.areaFillBottom]),
            startPoint: CGPoint(x: 0, y: sy(0)),
            endPoint: CGPoint(x: 0, y: baseY)))
        context.stroke(linePath, with: .color(ChartPalette.line.opacity(0.9)),
                       style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))

        // Selected-day segment overlay (accent), up to the selected camp's x.
        if let marker = selectedMarker() {
            let segment = model.points.filter { $0.x <= marker.x }
            if segment.count >= 2 {
                let segPts = segment.map { CGPoint(x: sx($0.x), y: sy($0.y)) }
                let segLine = pathThrough(segPts)
                let segArea = closedArea(from: segPts, baseY: baseY)
                context.fill(segArea, with: .linearGradient(
                    Gradient(colors: [ChartPalette.accent.opacity(0.3), ChartPalette.accent.opacity(0)]),
                    startPoint: CGPoint(x: 0, y: sy(0)),
                    endPoint: CGPoint(x: 0, y: baseY)))
                context.stroke(segLine, with: .color(ChartPalette.accent.opacity(0.6)),
                               style: StrokeStyle(lineWidth: 2, lineJoin: .round))
            }
        }

        // Camp markers.
        for marker in model.campMarkers {
            let isSelected = marker.campID == selectedCampID
            let isHovered = hover?.campName == marker.name
            let center = CGPoint(x: sx(marker.x), y: sy(marker.y))

            if isSelected || isHovered {
                let r: CGFloat = isSelected ? 10 : 8
                let haloRect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
                let fill: Color = isSelected ? ChartPalette.accent.opacity(0.3) : ChartPalette.line.opacity(0.15)
                context.fill(Path(ellipseIn: haloRect), with: .color(fill))
            }

            // Dot ring is a keyline of page-background colour (`ChartPalette.dotRing`), not a
            // fixed black/white — the same "ring matches the page" trick as a system separator,
            // adaptive instead of assuming one fixed appearance.
            let r: CGFloat = isSelected ? 5 : 4
            let dotRect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
            let dot = Path(ellipseIn: dotRect)
            context.fill(dot, with: .color(isSelected ? ChartPalette.accent : ChartPalette.line.opacity(0.9)))
            context.stroke(dot, with: .color(ChartPalette.dotRing), lineWidth: isSelected ? 2 : 1)

            var label = Text("D\(marker.dayNumber)")
                .font(.system(size: 8, weight: isSelected ? .semibold : .regular))
            label = label.foregroundColor(isSelected ? ChartPalette.accent : Theme.textTertiary)
            context.draw(label, at: CGPoint(x: center.x, y: center.y - 12), anchor: .center)
        }

        // Hover crosshair + dot.
        if let hover {
            var cross = Path()
            cross.move(to: CGPoint(x: sx(hover.logicalX), y: sy(0)))
            cross.addLine(to: CGPoint(x: sx(hover.logicalX), y: sy(Self.logicalHeight)))
            context.stroke(cross, with: .color(Theme.textSecondary.opacity(0.5)),
                           style: StrokeStyle(lineWidth: 1, dash: [4, 4]))

            let c = CGPoint(x: sx(hover.logicalX), y: sy(hover.logicalY))
            let dotRect = CGRect(x: c.x - 3, y: c.y - 3, width: 6, height: 6)
            context.fill(Path(ellipseIn: dotRect), with: .color(ChartPalette.line))
            context.stroke(Path(ellipseIn: dotRect), with: .color(ChartPalette.dotRing), lineWidth: 1)
        }
    }

    private func pathThrough(_ pts: [CGPoint]) -> Path {
        var p = Path()
        guard let first = pts.first else { return p }
        p.move(to: first)
        for pt in pts.dropFirst() { p.addLine(to: pt) }
        return p
    }

    private func closedArea(from pts: [CGPoint], baseY: CGFloat) -> Path {
        var p = pathThrough(pts)
        guard let first = pts.first, let last = pts.last else { return p }
        p.addLine(to: CGPoint(x: last.x, y: baseY))
        p.addLine(to: CGPoint(x: first.x, y: baseY))
        p.closeSubpath()
        return p
    }

    // MARK: - Overlays

    @ViewBuilder
    private func tooltip(size: CGSize) -> some View {
        if let hover {
            let x = screenX(hover.logicalX, size: size)
            let clampedX = min(max(x, 44), size.width - 44)
            Group {
                if let name = hover.campName {
                    Text(name).font(.system(size: 10, weight: .medium))
                } else {
                    (Text("\(hover.dist, specifier: "%.1f") km")
                        .foregroundColor(Theme.textSecondary)
                     + Text("  ·  ").foregroundColor(Theme.textTertiary)
                     + Text("\(Int(hover.ele.rounded()))m"))
                        .font(.system(size: 10))
                }
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.hairline))
            .fixedSize()
            .position(x: clampedX, y: 8)
            .allowsHitTesting(false)
            // Transient crosshair readout, driven by a drag the user is performing. The equivalent
            // for a screen reader is stepping the Audio Graph, not a floating label that appears and
            // disappears under someone else's finger.
            .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var resetButton: some View {
        if zoom > 1 {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { zoom = 1; originX = 0 }
            } label: {
                Text("Reset (\(zoom, specifier: "%.1f")×)")
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Theme.fillSubtle, in: RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .padding(6)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .accessibilityLabel("Reset the zoom")
        }
    }

    /// The three corner labels are the chart's axes, and each is a fragment out of context — "0 km",
    /// a bare elevation range, a bare distance. Combined into one element that says what they are;
    /// the same numbers also reach the chart's own `accessibilityValue` above, so this is hidden
    /// rather than duplicated.
    private var axisLabels: some View {
        HStack {
            Text("0 km")
            Spacer()
            Text("\(Int(model.minEle.rounded()))m – \(Int(model.maxEle.rounded()))m")
            Spacer()
            Text("\(Int(model.totalDist.rounded())) km")
        }
        .font(.system(size: 10))
        .foregroundStyle(Theme.textTertiary)
        .accessibilityHidden(true)
    }

    private var hint: LocalizedStringKey { "Pinch to zoom · Drag to scrub · Tap a day marker" }

    // MARK: - Gestures

    private func magnifyGesture(size: CGSize) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                if pinchBaseZoom == nil { pinchBaseZoom = zoom; pinchBaseOrigin = originX }
                guard let bz = pinchBaseZoom, let bo = pinchBaseOrigin else { return }
                let newZoom = min(maxZoom, max(minZoom, bz * value.magnification))
                let anchor = value.startAnchor.x       // 0…1 across the view
                let baseViewW = Self.logicalWidth / bz
                let newViewW = Self.logicalWidth / newZoom
                let anchorLogicalX = bo + anchor * baseViewW
                var newOrigin = anchorLogicalX - anchor * newViewW
                newOrigin = min(max(newOrigin, 0), Self.logicalWidth - newViewW)
                zoom = newZoom
                originX = newOrigin
            }
            .onEnded { _ in pinchBaseZoom = nil; pinchBaseOrigin = nil }
    }

    /// Tap a camp dot to select its day. A `SpatialTapGesture` (rather than the drag's
    /// `.onEnded`) keeps taps distinct from pans and lets a small drag fall through to an
    /// enclosing scroll view.
    private func tapGesture(size: CGSize) -> some Gesture {
        SpatialTapGesture()
            .onEnded { value in
                let lx = logicalX(fromScreenX: value.location.x, size: size)
                if let marker = model.nearestCampMarker(toLogicalX: lx, within: 20) {
                    onSelectCamp?(marker)
                }
            }
    }

    private func dragGesture(size: CGSize) -> some Gesture {
        // minimumDistance 12 so a short touch is a tap (handled by `tapGesture`) and a small
        // vertical drag passes through to an enclosing scroll view.
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                guard pinchBaseZoom == nil else { return }   // pinch owns the interaction
                if zoom > 1 {
                    if dragBaseOrigin == nil { dragBaseOrigin = originX }
                    let viewW = viewWidth()
                    let drawable = max(size.width - hInset * 2, 1)
                    let deltaLogical = -value.translation.width / drawable * viewW
                    originX = min(max((dragBaseOrigin ?? originX) + deltaLogical, 0),
                                  Self.logicalWidth - viewW)
                } else {
                    updateHover(atScreenX: value.location.x, size: size)
                }
            }
            .onEnded { _ in
                dragBaseOrigin = nil
            }
    }

    private func updateHover(atScreenX x: CGFloat, size: CGSize) {
        let lx = logicalX(fromScreenX: x, size: size)
        guard let point = model.nearestPoint(toLogicalX: lx) else { return }
        let camp = model.nearestCampMarker(toLogicalX: lx, within: 10)
        hover = Hover(logicalX: point.x, logicalY: point.y,
                      dist: point.dist, ele: point.ele, campName: camp?.name)
    }

    // MARK: - Helpers

    private func selectedMarker() -> ElevationProfileModel.CampMarker? {
        guard let id = selectedCampID else { return nil }
        return model.campMarkers.first { $0.campID == id }
    }

    private func applyInitialStateIfNeeded() {
        guard !didApplyInitialState else { return }
        didApplyInitialState = true
        if initialZoom > 1 {
            zoom = min(maxZoom, max(minZoom, initialZoom))
            let viewW = viewWidth()
            if let cross = initialCrosshairLogicalX {
                originX = min(max(cross - viewW / 2, 0), Self.logicalWidth - viewW)
            } else {
                originX = min(max((Self.logicalWidth - viewW) / 2, 0), Self.logicalWidth - viewW)
            }
        }
        if let cross = initialCrosshairLogicalX, let point = model.nearestPoint(toLogicalX: cross) {
            let camp = model.nearestCampMarker(toLogicalX: cross, within: 10)
            hover = Hover(logicalX: point.x, logicalY: point.y,
                          dist: point.dist, ele: point.ele, campName: camp?.name)
        }
    }

    // MARK: - Geometry constants (colour palette lives in `ChartPalette`)

    private static let logicalWidth = ElevationProfileModel.logicalWidth
    private static let logicalHeight = ElevationProfileModel.logicalHeight
}

// MARK: - Audio Graph (QUA-07)

/// The chart described as data rather than as pixels, so VoiceOver's Audio Graph can explore it:
/// swipe through the profile point by point, hear the values read, or play the whole ascent as a
/// rising tone. This is the one accessibility affordance that makes an elevation profile genuinely
/// *readable* without sight, as opposed to merely announced.
///
/// Two series, matching what is drawn: the continuous profile, and the days as discrete points. The
/// day series is separate rather than annotated onto the first because the days are what the reader
/// navigates by — "which day is the hard climb" is the question this chart gets asked, and it is
/// answerable by stepping the second series.
///
/// Axes are in real units (km along the route, metres above sea level), NOT the 300 × 120 logical
/// space the `Canvas` draws in. That space exists for SVG parity with the web and means nothing to a
/// listener; `ElevationProfileModel.Point` carries both, so the projection stays a drawing concern.
extension InteractiveElevationProfileView: AXChartDescriptorRepresentable {

    /// Evenly thin `points` to at most `limit` samples, always keeping the last one.
    ///
    /// A real GPX route is thousands of vertices, and an Audio Graph the reader has to step through
    /// one vertex at a time is not explorable — it is a very long list. Keeping the final point is
    /// what makes the described route end where the route ends, which a plain `stride` does not
    /// guarantee.
    ///
    /// The stride is a CEILING, not `count / limit`. Integer division rounds down, so 188 points
    /// against a limit of 120 gave a stride of 1 and thinned nothing — 188 samples out of a promised
    /// 120. Every fixture in the repo sits in that band (the Kilimanjaro route is 188 points), so the
    /// bug would have shipped as "the limit does nothing until a route is twice as long as it needs to
    /// be". Caught by the test below, which is why the sampling is internal and static rather than
    /// inlined into `makeChartDescriptor`.
    static func sample(_ points: [ElevationProfileModel.Point], limit: Int = 120)
        -> [ElevationProfileModel.Point] {
        guard points.count > limit, limit > 0 else { return points }
        let stride = (points.count + limit - 1) / limit
        return points.enumerated()
            .filter { index, _ in index % stride == 0 || index == points.count - 1 }
            .map(\.element)
    }

    func makeChartDescriptor() -> AXChartDescriptor {
        let sampled = Self.sample(model.points)

        let xAxis = AXNumericDataAxisDescriptor(
            title: String(localized: "Distance along the route",
                          comment: "Elevation chart Audio Graph: the horizontal axis."),
            range: 0...Swift.max(model.totalDist, 1),
            gridlinePositions: []) { value in
                Formatters.distanceKm(value)
            }

        let yAxis = AXNumericDataAxisDescriptor(
            title: String(localized: "Elevation",
                          comment: "Elevation chart Audio Graph: the vertical axis."),
            range: model.plotMinEle...Swift.max(model.plotMaxEle, model.plotMinEle + 1),
            gridlinePositions: []) { value in
                Formatters.meters(Int(value.rounded()))
            }

        let profile = AXDataSeriesDescriptor(
            name: String(localized: "Elevation profile",
                         comment: "Elevation chart Audio Graph: the continuous route profile series."),
            isContinuous: true,
            dataPoints: sampled.map { AXDataPoint(x: $0.dist, y: $0.ele) })

        let days = AXDataSeriesDescriptor(
            name: String(localized: "Days",
                         comment: "Elevation chart Audio Graph: the series of day markers."),
            isContinuous: false,
            dataPoints: model.campMarkers.map { marker in
                AXDataPoint(x: marker.dist, y: marker.ele,
                            additionalValues: [],
                            label: String(localized: "Day \(marker.dayNumber) — \(marker.name)",
                                          comment: "Elevation chart Audio Graph: one day marker."))
            })

        return AXChartDescriptor(
            title: String(localized: "Elevation profile",
                          comment: "Elevation chart Audio Graph: the chart's title."),
            summary: nil,
            xAxis: xAxis,
            yAxis: yAxis,
            additionalAxes: [],
            series: model.campMarkers.isEmpty ? [profile] : [profile, days])
    }

    func updateChartDescriptor(_ descriptor: AXChartDescriptor) {
        // Nothing to reconcile: the descriptor is derived entirely from `model`, which is a `let` on
        // this view. Zoom, pan and the crosshair are drawing state and deliberately do NOT narrow the
        // described data — a listener exploring the profile should get the whole route, not whatever
        // window a sighted user last pinched to.
    }
}

#Preview {
    let journey = try! FixtureLoader.load(named: "kilimanjaro", bundle: .main)
    return InteractiveElevationProfileView(
        model: ElevationProfileModel(journey: journey)!,
        selectedCampID: journey.camps.first(where: { $0.name.contains("Barafu") })?.id
    )
    .padding()
    .background(Theme.background)
    .preferredColorScheme(.dark)
}
