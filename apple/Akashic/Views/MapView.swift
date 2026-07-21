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

/// Map tab — pick a journey and view its route.
struct MapView: View {
    @EnvironmentObject private var store: JourneyStore
    @State private var selectedID: String?

    private var selected: Journey? {
        store.journey(withID: selectedID ?? store.journeys.first?.id ?? "")
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let journey = selected {
                RouteMapView(journey: journey)
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .top) { picker }
            } else {
                ContentUnavailableView("No route", systemImage: "map")
            }
        }
        .navigationTitle("Map")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { if selectedID == nil { selectedID = store.journeys.first?.id } }
    }

    private var picker: some View {
        Menu {
            ForEach(store.journeys) { journey in
                Button {
                    selectedID = journey.id
                } label: {
                    Label(journey.shortName, systemImage: journey.id == selected?.id ? "checkmark" : "mountain.2")
                }
            }
        } label: {
            HStack(spacing: 8) {
                Text(selected?.countryFlag ?? "🌍")
                Text(selected?.shortName ?? "Select")
                    .font(.subheadline.weight(.semibold))
                Image(systemName: "chevron.down")
                    .font(.caption2)
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.vertical, 10)
            .padding(.horizontal, 16)
            .background(.ultraThinMaterial, in: Capsule())
        }
        .padding(.top, 8)
    }
}

#Preview {
    NavigationStack { MapView() }
        .environmentObject(JourneyStore(persistence: .preview))
        .preferredColorScheme(.dark)
}
