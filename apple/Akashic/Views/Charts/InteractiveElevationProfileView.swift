import SwiftUI

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

                tooltip(size: size)
                resetButton
            }
        }
        .frame(height: chartHeight)
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
        }
    }

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
    }

    private var hint: String { "Pinch to zoom · Drag to scrub · Tap a day marker" }

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
