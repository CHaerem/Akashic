import SwiftUI
import MapKit
import CoreLocation

/// The app's landing experience: a full-screen MapKit globe that frames all journeys as
/// glowing pins, spins idly, and — on tapping a pin or journey card — flies into that
/// journey's overview and day-by-day navigation. This is the primary screen; the flat
/// journey list stays reachable via the "Journeys" button (a sheet).
///
/// Ported from the MapKitGlobe spike (`apple/Spikes/MapKitGlobe`), adapted to the app's
/// `Journey`/`Camp`/`Route` domain. See `TrekCameraController` for the camera choreography
/// and `MapGeoMath` for the (unit-tested) geometry.
struct GlobeExperienceView: View {
    @EnvironmentObject private var store: JourneyStore

    /// Optional photo thumbnail markers. Defaults to empty so trek mode renders without
    /// photos; the Import / photo agent can map their photos into `[MapPhoto]` and pass
    /// them here later without touching this file.
    var photos: [MapPhoto] = []

    @StateObject private var controller = TrekCameraController()
    @State private var showingJourneyList = false
    @State private var didApplyLaunch = false

    // Photos for the selected journey (loaded from the store) + the day each resolves to,
    // used both for the map's photo markers and for opening the lightbox.
    @State private var journeyPhotos: [Photo] = []
    @State private var photoDayByID: [String: Int] = [:]
    // Split lightbox state so a day-mode photo-marker tap can present *over* the day sheet:
    // the overview cover lives on the map overlays, the day cover inside the day sheet's own
    // presentation hierarchy (a background cover can't appear above an active sheet).
    @State private var overviewLightbox: LightboxData?
    @State private var dayLightbox: LightboxData?
    @State private var sheetDetent: PresentationDetent = .medium
    @State private var showingPhotoGrid = false
    @State private var showingNewJourney = false

    var body: some View {
        ZStack {
            MapStarfieldView()

            map
                .ignoresSafeArea()
                .sheet(isPresented: daySheetPresented) {
                    daySheet
                }

            overlays
                .fullScreenCover(item: $overviewLightbox) { data in
                    PhotoLightboxView(data: data)
                }
        }
        .background(Theme.background.ignoresSafeArea())
        .statusBarHidden(true)
        .onAppear {
            controller.configure(journeys: store.journeys)
            guard !didApplyLaunch else { return }
            didApplyLaunch = true
            controller.applyLaunchScene()
            loadPhotos(for: controller.selectedJourney)
            applyScreenshotSeams()
        }
        .onChange(of: store.journeys) { _, new in
            controller.configure(journeys: new)
        }
        .onChange(of: controller.selectedJourneyID) { _, _ in
            loadPhotos(for: controller.selectedJourney)
        }
        // Spotlight deep link: SpotlightIndexer records the tapped journey on the
        // store; fly the globe there and clear the pending selection.
        .onChange(of: store.pendingJourneySelection) { _, id in
            if let id, let journey = store.journey(withID: id) {
                controller.selectJourney(journey)
                store.pendingJourneySelection = nil
            }
        }
        .sheet(isPresented: $showingJourneyList) {
            NavigationStack { JourneyListView() }
                .environmentObject(store)
                .preferredColorScheme(.dark)
        }
        .fullScreenCover(isPresented: $showingPhotoGrid) {
            if let journey = controller.selectedJourney {
                NavigationStack { PhotosGridView(journeyID: journey.id) }
                    .environmentObject(store)
                    .preferredColorScheme(.dark)
            }
        }
        .sheet(isPresented: $showingNewJourney) {
            NewJourneySheet()
                .environmentObject(store)
        }
    }

    // MARK: - Day detail sheet

    /// Presented whenever a specific day is selected in trek mode. Dismissing (swipe down)
    /// returns to the journey overview.
    private var daySheetPresented: Binding<Bool> {
        Binding(
            get: { controller.selectedDayIndex != nil && !controller.isGlobe },
            set: { presented in if !presented { controller.showOverview() } }
        )
    }

    @ViewBuilder
    private var daySheet: some View {
        if let journey = controller.selectedJourney, let dayIndex = controller.selectedDayIndex {
            DayDetailSheet(
                journey: journey,
                dayIndex: dayIndex,
                onSelectDay: { controller.selectDay($0) },
                onClose: { controller.showOverview() }
            )
            .environmentObject(store)
            .preferredColorScheme(.dark)
            .presentationDetents([.medium, .large], selection: $sheetDetent)
            .presentationBackgroundInteraction(.enabled(upThrough: .medium))
            .presentationBackground(Theme.background)
            // Day-mode photo-marker taps present here, inside the sheet's own hierarchy, so the
            // lightbox appears above the day sheet instead of being blocked by it.
            .fullScreenCover(item: $dayLightbox) { data in
                PhotoLightboxView(data: data, journey: journey).environmentObject(store)
            }
        }
    }

    // MARK: - Map

    private var map: some View {
        Map(position: $controller.cameraPosition, interactionModes: .all) {
            mapContent
        }
        .mapStyle(.hybrid(elevation: .realistic, pointsOfInterest: .excludingAll))
        .mapControlVisibility(.hidden)
        // Stop the idle spin on any user pan / zoom gesture (spec §1b).
        .simultaneousGesture(DragGesture().onChanged { _ in
            if controller.isRotating { controller.stopRotation() }
        })
        .simultaneousGesture(MagnifyGesture().onChanged { _ in
            if controller.isRotating { controller.stopRotation() }
        })
    }

    @MapContentBuilder
    private var mapContent: some MapContent {
        if controller.isGlobe {
            globePins
        } else if let journey = controller.selectedJourney {
            trekOverlays(journey)
        }
    }

    // MARK: Globe pins (spec §2c)

    @MapContentBuilder
    private var globePins: some MapContent {
        ForEach(store.journeys) { journey in
            if let coord = journey.pinCoordinate {
                Annotation(journey.shortName, coordinate: coord, anchor: .center) {
                    JourneyPin()
                        .onTapGesture { controller.selectJourney(journey) }
                }
                .annotationTitles(.hidden)
            }
        }
    }

    // MARK: Trek overlays (route + segment + camps + photos, spec §2a/§2b/§2d/§2e)

    @MapContentBuilder
    private func trekOverlays(_ journey: Journey) -> some MapContent {
        // Full route: white 0.8 (2 pt) over a white 0.15 (12 pt) glow underlay.
        MapPolyline(coordinates: journey.route.clCoordinates)
            .stroke(Color.white.opacity(0.15),
                    style: StrokeStyle(lineWidth: 12, lineCap: .round, lineJoin: .round))
        MapPolyline(coordinates: journey.route.clCoordinates)
            .stroke(Color.white.opacity(0.8),
                    style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

        // Selected day's cyan segment: 4 pt over a 15 pt glow.
        if let seg = selectedSegment(for: journey) {
            MapPolyline(coordinates: seg)
                .stroke(MapPalette.cyan.opacity(0.5),
                        style: StrokeStyle(lineWidth: 15, lineCap: .round, lineJoin: .round))
            MapPolyline(coordinates: seg)
                .stroke(MapPalette.cyan,
                        style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
        }

        // Amber day-number camp badges (selected bigger + brighter).
        ForEach(Array(journey.camps.enumerated()), id: \.element.id) { index, camp in
            Annotation(camp.name, coordinate: camp.clCoordinate, anchor: .center) {
                CampBadge(day: camp.dayNumber, selected: controller.selectedDayIndex == index)
                    .onTapGesture { controller.selectDay(index) }
            }
            .annotationTitles(.hidden)
        }

        // Optional photo thumbnail markers (only the selected day's when a day is active).
        // Tapping one opens the lightbox scoped to that day's photos.
        ForEach(visiblePhotos(for: journey)) { photo in
            Annotation("Photo", coordinate: photo.coordinate, anchor: .center) {
                PhotoMarker(photo: photo)
                    .onTapGesture { openLightbox(for: photo) }
            }
            .annotationTitles(.hidden)
        }
    }

    private func selectedSegment(for journey: Journey) -> [CLLocationCoordinate2D]? {
        guard let i = controller.selectedDayIndex else { return nil }
        let coords = MapGeoMath.daySegment(dayIndex: i,
                                           camps: journey.camps,
                                           route: journey.route.coordinates).coordinates
        return coords.isEmpty ? nil : coords
    }

    /// Photo markers to render: the store-derived markers for the selected journey, falling
    /// back to any externally-passed `photos` (the map agent's original hook).
    private var allMapPhotos: [MapPhoto] {
        guard journeyPhotos.isEmpty else {
            return journeyPhotos.compactMap { photo in
                guard let coords = photo.coordinates, coords.count >= 2 else { return nil }
                return MapPhoto(id: photo.id, latitude: coords[1], longitude: coords[0],
                                dayNumber: photoDayByID[photo.id],
                                thumbnailURL: photo.thumbnailFileURL)
            }
        }
        return photos
    }

    private func visiblePhotos(for journey: Journey) -> [MapPhoto] {
        let source = allMapPhotos
        guard !source.isEmpty else { return [] }
        // When a day is selected, show only that day's photos (if they carry a day);
        // otherwise show all of the journey's photos in overview.
        if let i = controller.selectedDayIndex, journey.camps.indices.contains(i) {
            let day = journey.camps[i].dayNumber
            let dayPhotos = source.filter { $0.dayNumber == day }
            return dayPhotos.isEmpty ? source : dayPhotos
        }
        return source
    }

    // MARK: - Photos

    private func loadPhotos(for journey: Journey?) {
        guard let journey else {
            journeyPhotos = []; photoDayByID = [:]; return
        }
        journeyPhotos = store.photos(forJourneyID: journey.id)
        let matcher = PhotoDayMatcher(journey: journey)
        var map: [String: Int] = [:]
        for photo in journeyPhotos {
            if let day = matcher.day(for: photo) { map[photo.id] = day }
        }
        photoDayByID = map
    }

    /// Open the lightbox for a tapped map marker, scoped to that photo's day (all journey
    /// photos when the marker carries no day).
    private func openLightbox(for mapPhoto: MapPhoto) {
        let list: [Photo]
        if let day = mapPhoto.dayNumber {
            list = journeyPhotos.filter { photoDayByID[$0.id] == day }
        } else {
            list = journeyPhotos
        }
        let index = list.firstIndex { $0.id == mapPhoto.id } ?? 0
        let data = LightboxData(
            photos: list.isEmpty ? journeyPhotos : list,
            startIndex: index,
            dayLabel: mapPhoto.dayNumber.map { "Day \($0)" }
        )
        // Route to the day cover (presented from the sheet) when a day sheet is up, else the
        // overview cover on the map overlays.
        if controller.selectedDayIndex != nil {
            dayLightbox = data
        } else {
            overviewLightbox = data
        }
    }

    // MARK: - Screenshot seams (deterministic states for Docs screenshots)
    //
    // All gated on env vars so normal launches are unaffected (mirrors the existing
    // AKASHIC_SCENE / AKASHIC_OPEN seams used by the map + app shell).
    //   AKASHIC_SHEET_DETENT=large  — open the day sheet at the large detent
    //   AKASHIC_PHOTO_GRID=1        — present the selected journey's photo grid
    //   AKASHIC_LIGHTBOX=1          — open the lightbox (use an overview scene so it isn't
    //                                 blocked by the day sheet); AKASHIC_LIGHTBOX_DAY picks
    //                                 the day (defaults to the selected day, else day 1).
    private func applyScreenshotSeams() {
        let env = ProcessInfo.processInfo.environment
        if env["AKASHIC_SHEET_DETENT"]?.lowercased() == "large" { sheetDetent = .large }
        if env["AKASHIC_PHOTO_GRID"] != nil, controller.selectedJourney != nil {
            showingPhotoGrid = true
        }
        if env["AKASHIC_LIGHTBOX"] != nil, let journey = controller.selectedJourney {
            let selectedDay = controller.selectedDayIndex.flatMap {
                journey.camps.indices.contains($0) ? journey.camps[$0].dayNumber : nil
            }
            let day = env["AKASHIC_LIGHTBOX_DAY"].flatMap(Int.init) ?? selectedDay ?? 1
            let dayPhotos = journeyPhotos.filter { photoDayByID[$0.id] == day }
            let list = dayPhotos.isEmpty ? journeyPhotos : dayPhotos
            if !list.isEmpty {
                let data = LightboxData(photos: list, startIndex: 0, dayLabel: "Day \(day)")
                if controller.selectedDayIndex != nil {
                    dayLightbox = data
                } else {
                    overviewLightbox = data
                }
            }
        }
    }

    // MARK: - Overlays (SwiftUI chrome)

    private var overlays: some View {
        VStack(spacing: 0) {
            topBar
            Spacer(minLength: 0)
            if controller.isGlobe {
                if store.journeys.isEmpty {
                    globeEmptyState
                        .padding(.bottom, 8)
                } else {
                    globeJourneyStrip
                        .padding(.bottom, 8)
                }
            } else if let journey = controller.selectedJourney,
                      controller.selectedDayIndex == nil {
                // In overview: the day navigator picks a starting day. Once a day is
                // selected, the DayDetailSheet takes over (and covers this area).
                DayNavigationView(journey: journey, controller: controller)
            }
        }
        .padding(.top, 8)
    }

    private var topBar: some View {
        HStack {
            if controller.isGlobe {
                Text("Akashic")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.textPrimary)
                    .shadow(color: .black.opacity(0.5), radius: 4)
            } else {
                Text(controller.selectedJourney?.shortName ?? "")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .shadow(color: .black.opacity(0.5), radius: 4)
            }
            Spacer()
            Button {
                showingJourneyList = true
            } label: {
                Label("Journeys", systemImage: "list.bullet")
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .foregroundStyle(Theme.textPrimary)
                    .background(.ultraThinMaterial, in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
    }

    // MARK: Globe empty state (no journeys yet)

    /// The front door for a brand-new customer: an inviting call to create the first journey,
    /// shown in place of the journey strip when the store is empty.
    private var globeEmptyState: some View {
        VStack(spacing: 12) {
            Text("Your journeys will live here")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .shadow(color: .black.opacity(0.5), radius: 4)
            Button {
                showingNewJourney = true
            } label: {
                Label("Start your first journey", systemImage: "plus")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.background)
                    .padding(.vertical, 14)
                    .padding(.horizontal, 22)
                    .background(Theme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
    }

    // MARK: Globe journey selector strip

    private var globeJourneyStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(store.journeys) { journey in
                    Button {
                        controller.selectJourney(journey)
                    } label: {
                        JourneyGlobeCard(journey: journey)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
        }
    }
}

/// Compact journey card shown in the globe's bottom strip. Tapping it flies into the
/// journey overview (mirrors tapping the journey's globe pin).
private struct JourneyGlobeCard: View {
    let journey: Journey

    var body: some View {
        HStack(spacing: 10) {
            Text(journey.countryFlag)
                .font(.system(size: 26))
            VStack(alignment: .leading, spacing: 2) {
                Text(journey.shortName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Text("\(journey.country) · \(journey.stats.duration) days")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(width: 200, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
    }
}

// MARK: - Journey pin coordinate

private extension Journey {
    /// Best-effort globe-pin coordinate: explicit centre → highest point → route midpoint.
    var pinCoordinate: CLLocationCoordinate2D? {
        guard let c = center, c.count >= 2 else { return nil }
        return CLLocationCoordinate2D(latitude: c[1], longitude: c[0])
    }
}

#Preview {
    GlobeExperienceView()
        .environmentObject(JourneyStore(persistence: .preview))
        .preferredColorScheme(.dark)
}
