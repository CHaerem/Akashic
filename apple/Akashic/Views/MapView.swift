import SwiftUI
import MapKit

/// Reusable flat map: route polyline + camp markers for one journey.
///
/// Deliberately minimal — the signature globe / 3D-terrain camera choreography is a
/// separate MapKit spike (see apple/Spikes). This is the read-only placeholder.
struct RouteMapView: View {
    let journey: Journey
    var interactive: Bool = true

    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        Map(position: $camera, interactionModes: interactive ? .all : []) {
            if journey.route.clCoordinates.count > 1 {
                MapPolyline(coordinates: journey.route.clCoordinates)
                    .stroke(Theme.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
            }
            ForEach(journey.camps) { camp in
                Marker(camp.name, systemImage: "tent.fill", coordinate: camp.clCoordinate)
                    .tint(Theme.accent)
            }
        }
        .mapStyle(.standard(elevation: .flat))
        .onAppear { camera = .region(journey.mapRegion) }
        .onChange(of: journey.id) { camera = .region(journey.mapRegion) }
    }
}

/// The Map screen is now the signature globe experience (`GlobeExperienceView`), wired as
/// the app's primary landing screen in `RootView`. The former flat picker-and-route
/// placeholder was replaced by the ported MapKit globe / trek choreography (see
/// `Views/Map/`). `RouteMapView` above is kept as the read-only route thumbnail used by
/// `JourneyDetailView`.
struct MapView: View {
    /// Optional photo markers forwarded to the globe experience (default empty).
    var photos: [MapPhoto] = []

    var body: some View {
        GlobeExperienceView(photos: photos)
    }
}

#Preview {
    MapView()
        .environmentObject(JourneyStore(persistence: .preview))
        .preferredColorScheme(.dark)
}
