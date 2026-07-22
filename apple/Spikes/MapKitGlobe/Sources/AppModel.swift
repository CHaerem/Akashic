import Foundation
import SwiftUI
import MapKit
import CoreLocation

/// Which stage of the choreography we are in.
enum Stage: Equatable {
    case globe
    case overview
    case day(Int) // 0-based index into trek.camps
}

enum MapStyleMode: String {
    case hybrid
    case imagery
}

/// Snapshot of the live camera for the HUD.
struct CameraReadout {
    var lat: Double = 0
    var lon: Double = 0
    var distance: Double = 0
    var pitch: Double = 0
    var heading: Double = 0
}

@MainActor
final class AppModel: ObservableObject {
    let trek: Trek

    @Published var stage: Stage = .globe
    @Published var mapStyleMode: MapStyleMode = .hybrid
    @Published var cameraPosition: MapCameraPosition
    @Published var readout = CameraReadout()
    @Published var isRotating = false

    // Spec: ROTATION_START_DELAY_MS = 3500; rotationSpeed = 2 deg/s.
    private let rotationStartDelay: TimeInterval = 3.5
    private let rotationSpeedDegPerSec: Double = 2.0
    private var rotationTimer: Timer?
    private var rotationToken = 0
    private var currentLon = GeoMath.globeCenter.longitude

    init(trek: Trek) {
        self.trek = trek
        self.cameraPosition = .camera(Self.mapCamera(from: GeoMath.globeCamera()))
    }

    // MARK: - Camera conversion

    static func mapCamera(from mk: MKMapCamera) -> MapCamera {
        MapCamera(
            centerCoordinate: mk.centerCoordinate,
            distance: mk.centerCoordinateDistance,
            heading: mk.heading,
            pitch: mk.pitch
        )
    }

    // MARK: - Camera builders

    func globeCamera(lon: Double? = nil) -> MKMapCamera {
        let cam = GeoMath.globeCamera()
        if let lon { cam.centerCoordinate = CLLocationCoordinate2D(latitude: GeoMath.globeCenter.latitude, longitude: lon) }
        return cam
    }

    /// Journey overview: fit the whole route, pitch = preferredPitch (60),
    /// heading = preferredBearing (-20).
    func overviewCamera() -> MKMapCamera {
        let coords = trek.route.map(\.coordinate)
        return GeoMath.fittingCamera(
            coords: coords,
            pitch: trek.preferredPitch,
            heading: trek.preferredBearing,
            fitFactor: 2.4,           // wider so the whole route fits the portrait frame
            minDistance: 30_000
        )
    }

    /// Day leg: fit the segment between the previous camp and the selected camp.
    /// pitch = camp.pitchOverride ?? 55; heading = camp.bearingOverride ?? route
    /// bearing from a point 5 vertices back.
    func dayCamera(_ index: Int) -> MKMapCamera {
        let camp = trek.camps[index]
        let startIdx = index == 0 ? 0 : trek.camps[index - 1].routeIndex
        let endIdx = camp.routeIndex
        let lo = min(startIdx, endIdx)
        let hi = max(startIdx, endIdx)
        var coords = trek.route[lo...hi].map(\.coordinate)
        coords.append(camp.coordinate)

        let pitch = camp.pitchOverride ?? 55
        let heading: Double
        if let b = camp.bearingOverride {
            heading = b
        } else {
            let backIdx = max(0, endIdx - 5)
            heading = GeoMath.bearing(from: trek.route[backIdx].coordinate,
                                      to: trek.route[endIdx].coordinate)
        }
        return GeoMath.fittingCamera(
            coords: coords,
            pitch: pitch,
            heading: heading,
            fitFactor: 2.0,
            minDistance: 2_800
        )
    }

    // MARK: - Transitions (map to Mapbox durations/easing)

    func flyToOverview() {
        stopRotation()
        stage = .overview
        withAnimation(.easeInOut(duration: 2.5)) {           // spec 1d: ~2.5 s ease-in-out
            cameraPosition = .camera(Self.mapCamera(from: overviewCamera()))
        }
    }

    func selectDay(_ index: Int) {
        stopRotation()
        stage = .day(index)
        withAnimation(.easeInOut(duration: 2.2)) {           // spec 1e: ~2.2 s
            cameraPosition = .camera(Self.mapCamera(from: dayCamera(index)))
        }
    }

    func resetToGlobe() {
        stage = .globe
        currentLon = GeoMath.globeCenter.longitude
        withAnimation(.easeOut(duration: 3.0)) {             // spec 1c: return to globe, 3 s
            cameraPosition = .camera(Self.mapCamera(from: globeCamera()))
        }
        scheduleRotation()
    }

    // MARK: - Idle rotation (spec 1b)

    /// Arm the 3.5 s timer; the globe sits still first, then drifts west 2°/s.
    func scheduleRotation() {
        stopRotation()
        rotationToken += 1
        let token = rotationToken
        DispatchQueue.main.asyncAfter(deadline: .now() + rotationStartDelay) { [weak self] in
            guard let self, token == self.rotationToken, case .globe = self.stage else { return }
            self.startRotation()
        }
    }

    private func startRotation() {
        isRotating = true
        let interval = 1.0 / 30.0
        rotationTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tickRotation(dt: interval) }
        }
    }

    private func tickRotation(dt: TimeInterval) {
        guard isRotating, case .globe = stage else { return }
        // Longitude DECREASES -> westward drift of the center (spec 1b).
        currentLon -= rotationSpeedDegPerSec * dt
        if currentLon < -180 { currentLon += 360 }
        cameraPosition = .camera(Self.mapCamera(from: globeCamera(lon: currentLon)))
    }

    /// Called on any user gesture or when a fly-in begins (spec 1b).
    func stopRotation() {
        isRotating = false
        rotationTimer?.invalidate()
        rotationTimer = nil
        rotationToken += 1 // cancel any pending scheduled start
    }

    // MARK: - HUD

    func updateReadout(_ camera: MapCamera) {
        readout = CameraReadout(
            lat: camera.centerCoordinate.latitude,
            lon: camera.centerCoordinate.longitude,
            distance: camera.distance,
            pitch: camera.pitch,
            heading: camera.heading
        )
    }

    // MARK: - Launch arguments (deterministic scenes for screenshots)

    func applyLaunchArguments() {
        let args = ProcessInfo.processInfo.arguments

        if let styleIdx = args.firstIndex(of: "--map-style"), styleIdx + 1 < args.count,
           let mode = MapStyleMode(rawValue: args[styleIdx + 1]) {
            mapStyleMode = mode
        }

        if let sceneIdx = args.firstIndex(of: "--scene"), sceneIdx + 1 < args.count {
            let scene = args[sceneIdx + 1]
            switch scene {
            case "globe":
                stage = .globe
                cameraPosition = .camera(Self.mapCamera(from: globeCamera()))
                scheduleRotation()
            case "overview":
                stage = .overview
                cameraPosition = .camera(Self.mapCamera(from: overviewCamera()))
            case "probe":
                // Diagnostic: sit very close and request a steep pitch to measure
                // MapKit's altitude-dependent pitch clamp (read the HUD).
                stage = .overview
                let cam = MKMapCamera()
                cam.centerCoordinate = trek.camps[5].coordinate // Uhuru
                cam.centerCoordinateDistance = 900
                cam.pitch = 75
                cam.heading = 90
                cameraPosition = .camera(Self.mapCamera(from: cam))
            default:
                if scene.hasPrefix("day"), let n = Int(scene.dropFirst(3)) {
                    let idx = max(0, min(trek.camps.count - 1, n - 1))
                    stage = .day(idx)
                    cameraPosition = .camera(Self.mapCamera(from: dayCamera(idx)))
                } else {
                    stage = .globe
                    scheduleRotation()
                }
            }
        } else {
            // Normal interactive launch: arm the idle spin.
            scheduleRotation()
        }
    }

    var selectedDayIndex: Int? {
        if case let .day(i) = stage { return i }
        return nil
    }
}
