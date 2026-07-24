import SwiftUI
import MapKit

/// Manual photo placement — the last gap in assisted creation. Some photos carry no EXIF GPS (or
/// carry a wrong fix); this sheet lets the user drop the pin themselves on a map.
///
/// Interaction is the familiar "drag the map under a fixed centre pin" pattern: the pin stays put
/// while the map pans beneath it, and Save records wherever the crosshair sits. The write goes
/// through the caller's `onSave` closure — from the photo editor that means
/// `JourneyStore.setPhotoLocation(_:source:forPhoto:)`, which stamps `locationSource = "manual"`
/// and syncs like any other edit. It is also reachable from the creation flow's day preview for
/// photos lacking a location.
struct PhotoPlacementSheet: View {
    @Environment(\.dismiss) private var dismiss

    var title: String = "Adjust location"
    /// The photo's current coordinate `[lng, lat]`, if any.
    var startCoordinate: [Double]?
    /// Where to open when the photo has no coordinate (day median, or journey centre).
    var fallbackCoordinate: [Double]?
    /// Called with the chosen `[lng, lat]` on Save.
    var onSave: ([Double]) -> Void

    @State private var camera: MapCameraPosition
    /// The live centre of the map (updated as it pans) — what Save records.
    @State private var center: CLLocationCoordinate2D

    init(title: String = "Adjust location",
         startCoordinate: [Double]? = nil,
         fallbackCoordinate: [Double]? = nil,
         onSave: @escaping ([Double]) -> Void) {
        self.title = title
        self.startCoordinate = startCoordinate
        self.fallbackCoordinate = fallbackCoordinate
        self.onSave = onSave

        let initial = Self.resolveStart(startCoordinate, fallbackCoordinate)
        _center = State(initialValue: initial)
        _camera = State(initialValue: .region(MKCoordinateRegion(
            center: initial,
            span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08))))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Map(position: $camera)
                    .mapStyle(.standard(elevation: .flat))
                    .onMapCameraChange(frequency: .continuous) { context in
                        center = context.region.center
                    }
                    .ignoresSafeArea(edges: .bottom)

                // Fixed centre pin: sits over the crosshair while the map moves beneath it.
                centrePin

                VStack {
                    Spacer()
                    coordinateReadout
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.tint(Theme.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave([center.longitude, center.latitude])
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .tint(Theme.accent)
                }
            }
        }
    }

    // MARK: Pieces

    private var centrePin: some View {
        // Pin's tip points at the exact centre, so nudge the glyph up by half its height.
        Image(systemName: "mappin")
            .font(.system(size: 34, weight: .bold))
            .foregroundStyle(Theme.accent)
            .shadow(radius: 3)
            .offset(y: -17)
            .allowsHitTesting(false)
    }

    private var coordinateReadout: some View {
        Text(String(format: "%.5f, %.5f", center.latitude, center.longitude))
            .font(.footnote.monospaced())
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
            .padding(.bottom, 24)
    }

    // MARK: Start resolution

    /// Choose the opening coordinate: the photo's own, else the fallback (day median / journey
    /// centre), else 0,0. Kept static so it can be reasoned about without the view.
    static func resolveStart(_ start: [Double]?, _ fallback: [Double]?) -> CLLocationCoordinate2D {
        if let start, start.count >= 2 {
            return CLLocationCoordinate2D(latitude: start[1], longitude: start[0])
        }
        if let fallback, fallback.count >= 2 {
            return CLLocationCoordinate2D(latitude: fallback[1], longitude: fallback[0])
        }
        return CLLocationCoordinate2D(latitude: 0, longitude: 0)
    }
}
