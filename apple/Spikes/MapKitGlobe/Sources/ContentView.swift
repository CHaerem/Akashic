import SwiftUI
import MapKit
import CoreLocation

struct ContentView: View {
    @ObservedObject var model: AppModel

    private var routeCoords: [CLLocationCoordinate2D] {
        model.trek.route.map(\.coordinate)
    }

    /// The highlighted cyan leg for the selected day.
    private var selectedSegment: [CLLocationCoordinate2D]? {
        guard let i = model.selectedDayIndex else { return nil }
        let camp = model.trek.camps[i]
        let start = i == 0 ? 0 : model.trek.camps[i - 1].routeIndex
        let end = camp.routeIndex
        let lo = min(start, end), hi = max(start, end)
        return Array(model.trek.route[lo...hi].map(\.coordinate))
    }

    private var showRoute: Bool {
        if case .globe = model.stage { return false }
        return true
    }

    private var showPin: Bool {
        if case .globe = model.stage { return true }
        return false
    }

    var body: some View {
        ZStack {
            // Night-sky backdrop (mostly occluded by MapKit's own space; see README).
            StarfieldView()

            map
                .ignoresSafeArea()

            overlays
        }
        .onAppear { model.applyLaunchArguments() }
    }

    // MARK: - Map

    private var map: some View {
        Map(position: $model.cameraPosition, interactionModes: .all) {
            if showRoute {
                // Soft white glow underlay (spec 2a)
                MapPolyline(coordinates: routeCoords)
                    .stroke(Color.white.opacity(0.15),
                            style: StrokeStyle(lineWidth: 12, lineCap: .round, lineJoin: .round))
                // Main white route line
                MapPolyline(coordinates: routeCoords)
                    .stroke(Color.white.opacity(0.8),
                            style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

                // Selected-day cyan segment with glow (spec 2b)
                if let seg = selectedSegment {
                    MapPolyline(coordinates: seg)
                        .stroke(Palette.cyan.opacity(0.5),
                                style: StrokeStyle(lineWidth: 15, lineCap: .round, lineJoin: .round))
                    MapPolyline(coordinates: seg)
                        .stroke(Palette.cyan,
                                style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                }

                // Camp badges
                ForEach(model.trek.camps) { camp in
                    Annotation(camp.name, coordinate: camp.coordinate, anchor: .center) {
                        CampBadge(day: camp.dayNumber,
                                  selected: model.selectedDayIndex.map { model.trek.camps[$0].id == camp.id } ?? false)
                    }
                    .annotationTitles(.hidden)
                }
            }

            if showPin {
                Annotation(model.trek.name, coordinate: model.trek.markerCoordinate, anchor: .center) {
                    JourneyPin()
                        .onTapGesture { model.flyToOverview() }
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(model.mapStyleMode == .hybrid
                  ? .hybrid(elevation: .realistic, pointsOfInterest: .excludingAll)
                  : .imagery(elevation: .realistic))
        .mapControlVisibility(.hidden)
        .onMapCameraChange(frequency: .continuous) { ctx in
            model.updateReadout(ctx.camera)
        }
        // Stop the idle spin on any user pan/zoom gesture (spec 1b).
        .simultaneousGesture(DragGesture().onChanged { _ in
            if model.isRotating { model.stopRotation() }
        })
        .simultaneousGesture(MagnifyGesture().onChanged { _ in
            if model.isRotating { model.stopRotation() }
        })
    }

    // MARK: - Overlays

    private var overlays: some View {
        VStack {
            HStack(alignment: .top) {
                HUDView(readout: model.readout,
                        stage: model.stage,
                        styleMode: model.mapStyleMode,
                        isRotating: model.isRotating)
                Spacer()
                styleToggle
            }
            Spacer()
            controls
        }
        .padding(12)
    }

    private var styleToggle: some View {
        Button {
            model.mapStyleMode = model.mapStyleMode == .hybrid ? .imagery : .hybrid
        } label: {
            Label(model.mapStyleMode == .hybrid ? "Hybrid" : "Imagery",
                  systemImage: "map")
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(.black.opacity(0.55), in: Capsule())
                .foregroundStyle(.white)
        }
    }

    @ViewBuilder
    private var controls: some View {
        VStack(spacing: 10) {
            // Day picker (1..8) — appears once we're past the globe.
            if !isGlobe {
                dayPicker
            }

            HStack(spacing: 10) {
                if isGlobe {
                    actionButton("Fly in", system: "airplane.departure") { model.flyToOverview() }
                } else {
                    actionButton("Overview", system: "scope") { model.flyToOverview() }
                    actionButton("Globe", system: "globe") { model.resetToGlobe() }
                }
            }
        }
    }

    private var isGlobe: Bool {
        if case .globe = model.stage { return true }
        return false
    }

    private var dayPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.trek.camps.indices, id: \.self) { i in
                    let camp = model.trek.camps[i]
                    Button {
                        model.selectDay(i)
                    } label: {
                        VStack(spacing: 1) {
                            Text("Day \(camp.dayNumber)")
                                .font(.system(size: 11, weight: .bold))
                            Text(camp.name.split(separator: " ").first.map(String.init) ?? "")
                                .font(.system(size: 9))
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(model.selectedDayIndex == i ? Palette.cyan.opacity(0.85) : .black.opacity(0.55),
                                    in: RoundedRectangle(cornerRadius: 8))
                        .foregroundStyle(model.selectedDayIndex == i ? .black : .white)
                    }
                }
            }
            .padding(.horizontal, 2)
        }
    }

    private func actionButton(_ title: String, system: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: system)
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(.ultraThinMaterial, in: Capsule())
                .foregroundStyle(.white)
        }
    }
}
