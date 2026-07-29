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
    @EnvironmentObject private var entitlements: EntitlementStore
    /// A1: pushed into `TrekCameraController` (an `ObservableObject`, not a `View`, so it can't
    /// read the environment itself) at launch and on every change, since the user can flip
    /// Reduce Motion while the app is running.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// D2: `presentationDetents` and `presentationBackgroundInteraction` — the two modifiers
    /// that make the day sheet sit at `.medium` over a still-interactive map — do not exist on
    /// iPad. Left alone, the exact same modifiers on `.regular` width still compile and still
    /// run, but silently become a form sheet that *occludes* the map, breaking the app's
    /// signature loop precisely where the product is most itself. Reading the size class here
    /// lets `.regular` route to a floating panel instead (`regularDayPanel`) while `.compact`
    /// (iPhone, and iPad Slide Over/narrow Split View) keeps the sheet byte-for-byte unchanged.
    /// This can change live: iPad multitasking (Split View resize, Slide Over) changes size
    /// class without relaunching the app, so this is read as a `@Environment`, not cached once.
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    /// Optional photo thumbnail markers. Defaults to empty so trek mode renders without
    /// photos; the Import / photo agent can map their photos into `[MapPhoto]` and pass
    /// them here later without touching this file.
    var photos: [MapPhoto] = []

    @StateObject private var controller = TrekCameraController()
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

    /// Everything this screen can present as a sheet, in ONE piece of state.
    ///
    /// Defensive, not a bug fix — all four destinations did work as separate
    /// `.sheet(isPresented:)` modifiers. But a view can only present one thing at a time, and four
    /// stacked presentation modifiers on one view is a documented way to lose one silently; this
    /// screen had grown to four and was the most likely place in the app to hit it. One
    /// `.sheet(item:)` over an enum cannot regress that way, and a fifth destination stays safe.
    private enum GlobeSheet: Identifiable {
        case journeyList
        case journeyDetail(String)   // journey id — the only route into an empty journey
        case newJourney
        case paywall

        var id: String {
            switch self {
            case .journeyList: return "list"
            case let .journeyDetail(id): return "detail-\(id)"
            case .newJourney: return "new"
            case .paywall: return "paywall"
            }
        }
    }

    @State private var sheet: GlobeSheet?

    /// Start a create attempt: below the free limit → open creation; at the limit → paywall.
    private func startCreate() {
        if entitlements.canCreateJourney(ownedCount: store.billableOwnedJourneyCount) {
            sheet = .newJourney
        } else {
            sheet = .paywall
        }
    }

    var body: some View {
        ZStack {
            MapStarfieldView()

            map
                .ignoresSafeArea()
                // D2: only presents as an actual sheet in compact width — see
                // `compactDaySheetPresented` and `regularDayPanel` below.
                .sheet(isPresented: compactDaySheetPresented) {
                    daySheet
                }

            overlays
                .fullScreenCover(item: $overviewLightbox) { data in
                    PhotoLightboxView(data: data)
                }

            // D2: the regular-width counterpart to the `.sheet` above — same content
            // (`daySheet`), different container, so the map stays visible and interactive
            // beside it instead of being covered. See `regularDayPanel`.
            if isRegularWidth {
                regularDayPanel
            }
        }
        // This screen is the immersive globe/trek map, not a page of chrome — it stays a fixed
        // night-sky dark in both appearances (see `MapPalette.nightSky` and the note on
        // `MapPalette` below), the same way Apple Maps and the Photos viewer stay dark behind
        // their content regardless of the system appearance. `Theme.background` would flash
        // system white behind the map in Light Mode before MapKit finishes drawing.
        .background(MapPalette.nightSky.ignoresSafeArea())
        // `.ultraThinMaterial` (used by `mapOverlayMaterial` above) doesn't just sample the
        // backdrop — it also tints itself from the *inherited* `colorScheme`, so with A3's
        // app-wide `.preferredColorScheme(.dark)` gone, flipping the system to Light Mode made
        // every glass pill on this screen visibly lighter/greyer even though it still sits over
        // the same dark satellite imagery (verified: compare a Light/Dark screenshot pair of
        // this screen). That is precisely the map-stops-being-immersive failure A3 says not to
        // introduce, so this screen — and only this screen — keeps a local forced-dark
        // `colorScheme`. A `.sheet` does not inherit the presenting view's `preferredColorScheme`,
        // so each sub-sheet this screen presents needs its own if it wants dark: only the day
        // sheet (`daySheet` below) still sets one, deliberately, to stay paired with this screen's
        // fixed-dark chrome (see the comment there). Journey list/detail, the photo grid, and the
        // paywall set none and are adaptive, following the system appearance like everywhere else.
        .preferredColorScheme(.dark)
        .statusBarHidden(true)
        .onAppear {
            controller.configure(journeys: store.journeys)
            controller.setReduceMotion(reduceMotion)
            // QUA-66: tell the camera what the day sheet will cover, so the fly-in lands its
            // subject in the visible region — medium detent ≈ the lower 45% on compact, the
            // regularDayPanel ≈ the leading 35% on regular.
            controller.setDayVisibleCover(isRegularWidth ? .leading(fraction: 0.35)
                                                         : .bottom(fraction: 0.45))
            guard !didApplyLaunch else { return }
            didApplyLaunch = true
            controller.applyLaunchScene()
            loadPhotos(for: controller.selectedJourney)
            applyScreenshotSeams()
        }
        .onChange(of: store.journeys) { _, new in
            controller.configure(journeys: new)
        }
        .onChange(of: reduceMotion) { _, newValue in
            controller.setReduceMotion(newValue)
        }
        .onChange(of: isRegularWidth) { _, regular in
            // QUA-66: size class flips on iPad multitasking/rotation; keep the cover honest.
            controller.setDayVisibleCover(regular ? .leading(fraction: 0.35)
                                                  : .bottom(fraction: 0.45))
        }
        .onChange(of: controller.selectedJourneyID) { _, _ in
            loadPhotos(for: controller.selectedJourney)
        }
        // Deep link: two sources now write here. SpotlightIndexer records a tapped journey by ID,
        // and SHIP-07's Universal Link handler records one by SLUG — `AppInfo.showcaseURL` addresses
        // journeys by slug, so an id-only lookup silently dropped every shared link. Resolving both
        // matches what `TrekCameraController.applyLaunchScene` already does for its launch key.
        .onChange(of: store.pendingJourneySelection) { _, key in
            if let key, let journey = store.journeys.first(where: { $0.id == key || $0.slug == key }) {
                controller.selectJourney(journey)
                store.pendingJourneySelection = nil
            }
        }
        .fullScreenCover(isPresented: $showingPhotoGrid) {
            if let journey = controller.selectedJourney {
                // Unlike the globe screen itself, this is an ordinary page of chrome (not the
                // immersive map), so it follows the system appearance like everywhere else —
                // it no longer needs its own forced-dark override.
                NavigationStack { PhotosGridView(journeyID: journey.id) }
                    .environmentObject(store)
            }
        }
        .sheet(item: $sheet) { destination in
            switch destination {
            case .journeyList:
                NavigationStack { JourneyListView() }
                    .environmentObject(store)
            case let .journeyDetail(id):
                if let journey = store.journey(withID: id) {
                    NavigationStack { JourneyDetailView(journey: journey) }
                        .environmentObject(store)
                        .environmentObject(entitlements)
                }
            case .newJourney:
                NewJourneySheet()
                    .environmentObject(store)
                    .environmentObject(entitlements)
            case .paywall:
                PaywallView(reason: .journeyLimit)
                    .environmentObject(entitlements)
            }
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

    private var isRegularWidth: Bool { horizontalSizeClass == .regular }

    /// Gates the ACTUAL `.sheet` presentation to compact width, reusing `daySheetPresented`'s own
    /// get/set rather than duplicating its logic. On `.regular` this always reports "not
    /// presented" so the system never mounts the sheet — `regularDayPanel` shows the same content
    /// (`daySheet`) as a floating panel instead. Doing this as a binding wrapper, instead of an
    /// `if isRegularWidth { }` around the `.sheet` modifier, keeps the modifier itself — and so the
    /// compact-width behaviour — textually identical to before this task.
    private var compactDaySheetPresented: Binding<Bool> {
        Binding(
            get: { daySheetPresented.wrappedValue && !isRegularWidth },
            set: { daySheetPresented.wrappedValue = $0 }
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
            // Unlike the journey list/detail/photo-grid presentations above (now adaptive),
            // this sheet keeps `.presentationBackgroundInteraction(.enabled(upThrough: .medium))`
            // — the immersive map is still visible and interactive behind it, not occluded. A
            // light sheet over the forced-dark globe would be the exact "map stops being
            // immersive" seam A3 says not to introduce, so this one deliberately stays paired
            // with the map's fixed-dark chrome. `DayDetailSheet` itself is the SAME view
            // presented (adaptively) from `JourneyDetailView` — it isn't hardcoded dark, this
            // sheet's forced scheme is what's pinning it here.
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

    /// D2's iPad counterpart to `daySheet`: same content (`daySheet` itself, not a fork of it —
    /// `DayChapterSections` was extracted precisely so both hosts render identical section
    /// stacks), a different container. ~380–420 pt (D2's own brief), `Theme.surface` fill, and the
    /// corner-radius/hairline pairing the app's other floating surface cards use
    /// (`JourneyStoryView`'s cover/chapter cards, `PaywallView`'s benefits card) — 20 pt
    /// continuous, `Theme.hairline` stroke — so this reads as the same design language, not a
    /// one-off. `DayDetailSheet`'s own `.background(Theme.background)` paints over most of the
    /// interior (it's a full ScrollView), which is fine: `background` and `surface` are adjacent
    /// system-fill tiers, and the outer `surface` still shows through at the rounded corners the
    /// inner flat-cornered fill doesn't reach.
    ///
    /// A sheet gets swipe-to-dismiss for free; a plain floating panel does not, so this adds an
    /// explicit close control wired to the same `controller.showOverview()` the phone sheet's
    /// dismissal calls — without it, `.regular` width would have no way back to the journey
    /// overview once a day is selected.
    private let regularDayPanelWidth: CGFloat = 400

    @ViewBuilder
    private var regularDayPanel: some View {
        if daySheetPresented.wrappedValue {
            HStack(spacing: 0) {
                ZStack(alignment: .topTrailing) {
                    daySheet

                    Button {
                        controller.showOverview()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(Theme.textSecondary)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close day")
                    .padding(4)
                }
                .frame(width: regularDayPanelWidth)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(Theme.hairline, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                // Clears the topBar (Journeys button / journey title) above rather than sitting
                // under it — `overlays` isn't `.ignoresSafeArea()`, so it already starts below the
                // notch/Dynamic Island; this only needs to additionally clear the bar's own height.
                .padding(.top, 64)
                .padding(.leading, 16)
                .padding(.bottom, 16)
                // Reduce Motion (A1): a slide-in is exactly the kind of self-initiated motion the
                // setting exists to remove — the panel still appears/disappears, just as a
                // cross-fade instead of a directional move, mirroring the globe fly-in's own
                // reduced-motion fallback in `TrekCameraController`.
                .transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))

                Spacer(minLength: 0)
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: controller.selectedDayIndex)
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
                    // Named after the journey (D1) — VoiceOver used to hear "Journey pin" for
                    // every pin on the globe, indistinguishable once there's more than one.
                    JourneyPin(name: journey.shortName)
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
            dayLabel: mapPhoto.dayNumber.map {
                String(localized: "Day \($0)",
                       comment: "Photo lightbox: badge naming the day a photo belongs to.")
            }
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
                let label = String(localized: "Day \(day)",
                                   comment: "Photo lightbox: badge naming the day a photo belongs to.")
                let data = LightboxData(photos: list, startIndex: 0, dayLabel: label)
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
                if journey.isEmptyShell {
                    // Flying into a journey with no route and no days lands on empty ocean — the
                    // camera has nothing to frame. Say so, and offer the one screen that can fix it.
                    JourneyNothingToShowPill(journeyName: journey.shortName) {
                        sheet = .journeyDetail(journey.id)
                    }
                } else {
                    // In overview: the day navigator picks a starting day. Once a day is
                    // selected, the DayDetailSheet takes over (and covers this area).
                    DayNavigationView(journey: journey, controller: controller)
                }
            }
        }
        .padding(.top, 8)
        // The map itself is the point of this screen; past xxLarge the chrome would keep
        // growing until it drowns it. Cap it here rather than in the map/day-sheet content.
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    private var topBar: some View {
        HStack {
            // 17/15 pt map to `.body`/`.subheadline` — the closest semantic styles, keeping
            // `.rounded` for the wordmark since that's a brand choice, not a size one.
            // `MapPalette.label`, not `Theme.textPrimary`: this text sits on the immersive
            // satellite map, which stays visually dark in both appearances, so its label needs
            // to stay a fixed light colour too — `Theme.textPrimary` would go near-black in
            // Light Mode and disappear into the imagery it's drawn over.
            if controller.isGlobe {
                Text("Akashic")
                    .font(.system(.body, design: .rounded).weight(.bold))
                    .foregroundStyle(MapPalette.label)
                    .shadow(color: .black.opacity(0.5), radius: 4)
            } else {
                Text(controller.selectedJourney?.shortName ?? "")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(MapPalette.label)
                    .shadow(color: .black.opacity(0.5), radius: 4)
            }
            Spacer()
            Button {
                sheet = .journeyList
            } label: {
                Label("Journeys", systemImage: "list.bullet")
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .foregroundStyle(MapPalette.label)
                    .mapOverlayMaterial(Capsule())
                    .overlay(Capsule().strokeBorder(MapPalette.hairline, lineWidth: 1))
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the list of every journey")
        }
        .padding(.horizontal, 12)
    }

    // MARK: Globe empty state (no journeys yet)

    /// The front door for a brand-new customer: an inviting call to create the first journey,
    /// shown in place of the journey strip when the store is empty.
    private var globeEmptyState: some View {
        VStack(spacing: 12) {
            Text("Your journeys will live here")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(MapPalette.label)
                .shadow(color: .black.opacity(0.5), radius: 4)
            Button {
                startCreate()
            } label: {
                Label("Start your first journey", systemImage: "plus")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
                    .padding(.vertical, 14)
                    .padding(.horizontal, 22)
                    .background(Theme.accent, in: Capsule())
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // QUA-10: `AkashicUITests` drives the create flow from here. An identifier rather
            // than the visible label, because the label is a localised catalogue string and a UI
            // test that stops finding its element still PASSES — it just never taps anything.
            // Identifiers are invisible to VoiceOver and never enter the string catalogue.
            .accessibilityIdentifier(A11yID.globeCreateFirstJourney)
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
    }

    /// Leading inset shared by the bottom chrome, so the journey strip and the tab bar sit on one
    /// vertical line instead of two. (A4-3 / QUA-30)
    ///
    /// **Matched by measurement, not by API**, because the tab bar's floating capsule is laid out by
    /// the system and exposes no metric. On a 402 pt screen the capsule's leading edge lands at 64 pt
    /// (x = 193 px of 1206 at @3x). Re-measure with a screenshot if the system chrome changes — a row
    /// through the tab bar and a row through the strip, comparing the first non-black pixel:
    ///
    ///     xs = [x for x in range(w) if sum(im.getpixel((x, y))) > 40]
    static let bottomChromeInset: CGFloat = 64

    // MARK: Globe journey selector strip

    private var globeJourneyStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(store.journeys) { journey in
                    Button {
                        controller.selectJourney(journey)
                    } label: {
                        JourneyGlobeCard(journey: journey, isSample: store.showsSampleBadge(journey.id))
                    }
                    .buttonStyle(.plain)
                }
            }
            // A4-3 (QUA-30): 12 pt left the strip and the tab bar sharing no alignment — measured
            // on a 402 pt screen, the first card started at 12 pt while the tab bar's capsule starts
            // at 64 pt, so they read as two unrelated floating objects instead of one bottom chrome.
            //
            // `Self.bottomChromeInset` is that measurement, named once. It is deliberately an inset on
            // the SCROLL CONTENT, not on the ScrollView: the strip still bleeds to both screen edges,
            // so a half-visible next card remains the affordance that says "scroll me". Only the
            // resting position of the first card moves.
            .padding(.horizontal, Self.bottomChromeInset)
        }
    }
}

/// Compact journey card shown in the globe's bottom strip. Tapping it flies into the
/// journey overview (mirrors tapping the journey's globe pin).
private struct JourneyGlobeCard: View {
    let journey: Journey
    /// D9: badges the bundled demo journey right on the landing screen — the surface the whole
    /// feature exists for ("an empty globe sells nothing").
    var isSample: Bool = false

    // The flag glyph was a fixed 26 pt icon, not body text; scale it like one so it stays
    // in proportion with the title next to it instead of going stale at larger sizes.
    @ScaledMetric(relativeTo: .title2) private var flagSize: CGFloat = 26

    var body: some View {
        HStack(spacing: 10) {
            // QUA-07: the country is named in words on the second line, so the flag is the same fact
            // as a picture — and VoiceOver announces it as its own element before the journey's name.
            Text(journey.countryFlag)
                .font(.system(size: flagSize))
                .accessibilityHidden(true)
            // On-map card (see the note on `topBar`): fixed `MapPalette` labels, not the
            // adaptive `Theme` ones, because this card floats over the immersive map in every
            // appearance. The SAMPLE badge is the one exception — `Theme.accent`/`.onAccent`
            // already sit on the map elsewhere (the "Start your first journey" CTA), so reusing
            // them here doesn't add a second on-map palette.
            VStack(alignment: .leading, spacing: 2) {
                // A4-1: the badge used to sit beside the title inside a hard 200 pt card, which left
                // "Kilimanjaro" rendering as "Kilima…" for anyone with the bundled sample — the
                // journey's name losing a fight with a label about the journey not being theirs.
                // Moved to the second line, where it competes with the country and day count instead:
                // both are secondary, and the title now gets the full width it needs.
                Text(journey.shortName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(MapPalette.label)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text("\(journey.country) · \(journey.stats.duration) days")
                        .font(.caption2)
                        .foregroundStyle(MapPalette.labelSecondary)
                        .lineLimit(1)
                    if isSample { SampleBadge() }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        // A4-1: was a hard 200 pt, which truncated something on every sample journey — first the
        // title, then (once the badge moved to line 2) the day count. A range lets the card stay
        // compact for a short name and take what it needs for "Kilimanjaro" plus a badge, while the
        // ceiling keeps it from running across a screen it is meant to float over.
        .frame(minWidth: 200, maxWidth: 260, alignment: .leading)
        .fixedSize(horizontal: true, vertical: false)
        .mapOverlayMaterial(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(MapPalette.hairline, lineWidth: 1)
        )
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        // Name, sample badge, country and day count are one card describing one journey — four
        // elements each was four swipes per journey along the strip.
        .accessibilityElement(children: .combine)
        .accessibilityHint("Flies the globe into this journey")
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
