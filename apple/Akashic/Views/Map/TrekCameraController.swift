import Foundation
import SwiftUI
import MapKit
import CoreLocation

/// Which stage of the choreography we are in.
///  - `.globe`   — the spinning planet with all journey pins (no selection).
///  - `.overview` — a journey selected, whole route fit to frame.
///  - `.day(i)`   — a specific day/leg of the selected journey (0-based into its camps).
enum MapStage: Equatable {
    case globe
    case overview
    case day(Int)
}

/// Camera choreography engine for the signature globe / trek map.
///
/// Ported from the MapKitGlobe spike's `AppModel` and adapted to drive the app's
/// `Journey` domain across THREE journeys (the globe shows all of them; selecting one
/// enters overview → day navigation). Transitions animate `MapCameraPosition` inside
/// `withAnimation`, so retargeting mid-flight (rapid day switching) interrupts the
/// in-flight animation cleanly and re-interpolates from the current camera.
@MainActor
final class TrekCameraController: ObservableObject {

    // MARK: Published state
    @Published var stage: MapStage = .globe
    @Published var selectedJourneyID: String?
    @Published var cameraPosition: MapCameraPosition
    @Published private(set) var isRotating = false

    /// Journeys backing the globe pins and camera math (set via `configure`).
    private(set) var journeys: [Journey] = []

    // MARK: Reduce Motion (A1)
    //
    // `TrekCameraController` is an `ObservableObject`, not a `View`, so it cannot read
    // `@Environment(\.accessibilityReduceMotion)` itself — `GlobeExperienceView` reads it and
    // pushes the value in via `setReduceMotion`, both at launch and on every change (the user
    // can flip the setting while the app is running). This is the single flag every camera
    // transition below checks: with it on, the idle globe spin never starts and every
    // `withAnimation` fly-in/fly-out becomes an instant cut instead — the destination is
    // always reached, just without the sweep, so the setting can never mean "stuck".
    private(set) var reduceMotion = false

    /// Called by the view whenever the environment's Reduce Motion value is known or changes.
    func setReduceMotion(_ enabled: Bool) {
        guard enabled != reduceMotion else { return }
        reduceMotion = enabled
        // Turning it on mid-spin must stop the spin immediately, not just suppress future
        // starts — a nauseating rotation already in flight is exactly the failure this exists
        // to prevent.
        if enabled { stopRotation() }
    }

    // MARK: Pitch clamp
    //
    // AMBITION: the Mapbox day legs and overview lean into the mountain at a 55–60°
    // oblique (spec §1d/§1e: preferredPitch 60, camp.pitch ?? 55). MapKit couples the
    // maximum pitch to the camera's altitude and HARD-CLAMPS it to ~30–35° at any altitude
    // that can frame a 5–17 km day leg (measured in the spike: 35° at 61 km / 12.5 km /
    // 5.1 km, and 30° for a 75°-request at 900 m — see Spikes/MapKitGlobe/README.md and
    // its `probe.png`). There is no iOS-17 or iOS-26 API to lift this clamp. So we REQUEST
    // 35° for day framing rather than 55–60°: asking for more just gets silently clamped
    // and looks identical, while 35° documents the real achievable oblique.
    //
    // RADAR: confirm the pitch-clamp behaviour with Apple (Feedback Assistant) before
    // locking decision D5 — an unclamped cinematic-camera mode is the feature to watch for.
    static let maxObliquePitch: Double = 35

    // MARK: Idle rotation config (spec §1b)
    private let rotationStartDelay: TimeInterval = 3.5   // ROTATION_START_DELAY_MS
    private let rotationSpeedDegPerSec: Double = 2.0     // rotationSpeed (desktop)
    private var rotationTimer: Timer?
    private var rotationToken = 0
    private var currentLon = MapGeoMath.globeCenter.longitude

    init() {
        cameraPosition = .camera(Self.mapCamera(from: MapGeoMath.globeCamera()))
    }

    func configure(journeys: [Journey]) {
        self.journeys = journeys
    }

    // MARK: - Derived state

    var selectedJourney: Journey? {
        guard let id = selectedJourneyID else { return nil }
        return journeys.first { $0.id == id }
    }

    var selectedDayIndex: Int? {
        if case let .day(i) = stage { return i }
        return nil
    }

    var isGlobe: Bool {
        if case .globe = stage { return true }
        return false
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

    private func globeCamera(longitude: Double? = nil) -> MKMapCamera {
        MapGeoMath.globeCamera(longitude: longitude)
    }

    /// Journey overview: fit the whole route, pitch = preferredPitch, heading =
    /// preferredBearing (spec §1d). MapKit clamps the requested pitch (see `maxObliquePitch`).
    func overviewCamera(for journey: Journey) -> MKMapCamera {
        let routeCoords = journey.route.clCoordinates
        let coords = routeCoords.isEmpty ? journey.camps.map(\.clCoordinate) : routeCoords
        return MapGeoMath.fittingCamera(
            coords: coords,
            pitch: journey.preferredPitch ?? 60,
            heading: journey.preferredBearing ?? 0,
            fitFactor: 2.4,          // wider so the whole route fits the portrait frame
            minDistance: 30_000
        )
    }

    /// Day leg: fit the segment between the previous camp and the selected camp; heading
    /// from the route vertex 5 back; pitch clamped to `maxObliquePitch` (spec §1e).
    func dayCamera(for journey: Journey, dayIndex: Int) -> MKMapCamera {
        let routeCoords = journey.route.clCoordinates
        let seg = MapGeoMath.daySegment(dayIndex: dayIndex,
                                        camps: journey.camps,
                                        route: journey.route.coordinates)
        let heading = MapGeoMath.routeBearing(toVertex: seg.endIndex, route: routeCoords)
        return MapGeoMath.fittingCamera(
            coords: seg.coordinates,
            pitch: Self.maxObliquePitch,
            heading: heading,
            fitFactor: 2.0,
            minDistance: 2_800
        )
    }

    // MARK: - Transitions (map to Mapbox durations / easing, spec §1c–§1e)

    /// Retarget the camera, animated normally or cut instantly under Reduce Motion (spec
    /// §1c–§1e's cinematic durations vs. A1's accessibility floor). A cut is not a shorter
    /// animation — it is no animation, so there is nothing for a vestibular-sensitive user to
    /// track, and the destination (the whole point of the interaction) is reached in the same
    /// gesture instead of after a multi-second sweep.
    private func setCamera(_ camera: MKMapCamera, animation: Animation) {
        let target = Self.mapCamera(from: camera)
        if reduceMotion {
            cameraPosition = .camera(target)
        } else {
            withAnimation(animation) {
                cameraPosition = .camera(target)
            }
        }
    }

    /// Globe → journey overview. Spec §1d: fit the route bbox, 2.5 s ease-in-out.
    func selectJourney(_ journey: Journey) {
        stopRotation()
        selectedJourneyID = journey.id
        stage = .overview
        setCamera(overviewCamera(for: journey), animation: .easeInOut(duration: 2.5))
    }

    /// Re-frame the selected journey's overview (the "Overview" button).
    func showOverview() {
        guard let journey = selectedJourney else { return }
        stopRotation()
        stage = .overview
        setCamera(overviewCamera(for: journey), animation: .easeInOut(duration: 2.5))
    }

    /// Fly the cinematic day leg. Spec §1e: ~2.2 s. Re-selecting another day mid-flight
    /// interrupts cleanly (a new `withAnimation` retargets from the live camera).
    func selectDay(_ index: Int) {
        guard let journey = selectedJourney, journey.camps.indices.contains(index) else { return }
        stopRotation()
        stage = .day(index)
        setCamera(dayCamera(for: journey, dayIndex: index), animation: .easeInOut(duration: 2.2))
    }

    func selectNextDay() {
        guard let journey = selectedJourney else { return }
        let next = (selectedDayIndex ?? -1) + 1
        if journey.camps.indices.contains(next) { selectDay(next) }
    }

    func selectPrevDay() {
        guard selectedJourney != nil, let current = selectedDayIndex, current > 0 else { return }
        selectDay(current - 1)
    }

    /// Return to the bare spinning globe. Spec §1c: 3 s ease-out, then re-arm the spin (which
    /// `scheduleRotation` itself no-ops under Reduce Motion — see below).
    func returnToGlobe() {
        selectedJourneyID = nil
        stage = .globe
        currentLon = MapGeoMath.globeCenter.longitude
        setCamera(globeCamera(), animation: .easeOut(duration: 3.0))
        scheduleRotation()
    }

    // MARK: - Idle rotation (spec §1b)

    /// Arm the 3.5 s timer; the globe sits still first, then drifts west at 2°/s.
    ///
    /// Under Reduce Motion this is a deliberate no-op: the globe is the app's landing screen,
    /// so a self-rotating planet is the single clearest "the app moved without being asked"
    /// case in the whole surface, and the setting exists precisely to stop that — not just to
    /// shorten it. There is no reduced-but-nonzero spin; the globe simply sits still.
    func scheduleRotation() {
        stopRotation()
        guard !reduceMotion else { return }
        rotationToken += 1
        let token = rotationToken
        DispatchQueue.main.asyncAfter(deadline: .now() + rotationStartDelay) { [weak self] in
            guard let self, token == self.rotationToken, self.isGlobe, !self.reduceMotion else { return }
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
        guard isRotating, isGlobe else { return }
        // Longitude DECREASES → westward drift of the center (spec §1b).
        currentLon -= rotationSpeedDegPerSec * dt
        if currentLon < -180 { currentLon += 360 }
        cameraPosition = .camera(Self.mapCamera(from: globeCamera(longitude: currentLon)))
    }

    /// Called on any user gesture or when a fly-in begins (spec §1b).
    func stopRotation() {
        isRotating = false
        rotationTimer?.invalidate()
        rotationTimer = nil
        rotationToken += 1 // cancel any pending scheduled start
    }

    // MARK: - Launch scene control (deterministic states for screenshots)
    //
    // Extends the app's existing `AKASHIC_*` launch-env seams (see RootView) with map
    // scene control, mirroring the spike's `--scene` pattern:
    //   AKASHIC_SCENE = globe | overview | day1 … dayN
    //   AKASHIC_JOURNEY = <journey id or slug>   (which journey overview/day applies to)
    //   AKASHIC_OPEN = <journey id or slug>      (existing seam → journey overview)

    func applyLaunchScene(environment env: [String: String] = ProcessInfo.processInfo.environment) {
        let scene = env["AKASHIC_SCENE"]?.lowercased()
        let journeyKey = env["AKASHIC_JOURNEY"] ?? env["AKASHIC_OPEN"]
        let target = journeyKey.flatMap { key in
            journeys.first { $0.id == key || $0.slug == key }
        } ?? journeys.first

        // AKASHIC_OPEN with no explicit scene → open that journey's overview.
        let resolvedScene = scene ?? (env["AKASHIC_OPEN"] != nil ? "overview" : nil)

        switch resolvedScene {
        case "globe", nil:
            stage = .globe
            selectedJourneyID = nil
            cameraPosition = .camera(Self.mapCamera(from: globeCamera()))
            scheduleRotation()
        case "overview":
            guard let journey = target else { scheduleRotation(); return }
            selectedJourneyID = journey.id
            stage = .overview
            cameraPosition = .camera(Self.mapCamera(from: overviewCamera(for: journey)))
        default:
            guard let journey = target, resolvedScene?.hasPrefix("day") == true,
                  let n = Int(resolvedScene!.dropFirst(3)) else {
                stage = .globe
                scheduleRotation()
                return
            }
            let idx = max(0, min(journey.camps.count - 1, n - 1))
            selectedJourneyID = journey.id
            stage = .day(idx)
            cameraPosition = .camera(Self.mapCamera(from: dayCamera(for: journey, dayIndex: idx)))
        }
    }
}
