import Foundation

#if canImport(CoreLocation)
import CoreLocation
#endif
#if canImport(MapKit)
import MapKit
#endif

/// Assisted journey creation — turn the coordinates the photos/route already carry into named
/// places, using Apple's own on-device-friendly location services (no servers):
///   * **Country** for the empty Country field — reverse-geocode the journey centroid.
///   * **Camp names** — reverse-geocode each day's median coordinate ("Barafu Camp" beats "Day 5"),
///     offered ONLY for days still carrying an auto-generated placeholder name.
///   * **Points of interest** — `MKLocalSearch` around a day's coordinate for viewpoints, summits,
///     lakes and huts, as accept-rows.
///
/// Every provider sits behind a protocol seam (`ReverseGeocoding` / `LocalPOISearching`) so the
/// composition logic here is unit-tested with fakes; the real `CLGeocoder` / `MKLocalSearch`
/// adapters live at the bottom of the file. Calls are serial with a small courtesy delay so we
/// stay friendly to Apple's rate limits. Nothing is written: the caller offers each result as a
/// suggestion the user accepts.

// MARK: - Provider value types (no CoreLocation/MapKit in the seam)

/// The fields we read off a reverse-geocode, flattened to plain values so tests never touch
/// `CLPlacemark`.
struct GeocodedPlace: Equatable {
    var countryName: String?
    var countryCode: String?        // ISO 3166-1 alpha-2
    var locality: String?           // city / town / village
    var subLocality: String?        // neighbourhood
    var administrativeArea: String? // state / region
    var areaOfInterest: String?     // named POI ("Barafu Camp", "Uhuru Peak")
    var name: String?               // placemark name (often the POI or a street)

    init(countryName: String? = nil, countryCode: String? = nil, locality: String? = nil,
         subLocality: String? = nil, administrativeArea: String? = nil,
         areaOfInterest: String? = nil, name: String? = nil) {
        self.countryName = countryName
        self.countryCode = countryCode
        self.locality = locality
        self.subLocality = subLocality
        self.administrativeArea = administrativeArea
        self.areaOfInterest = areaOfInterest
        self.name = name
    }

    /// Best short label for a day/camp: a named area/POI first, then locality, then region.
    /// `name` is used only if it isn't just a street number echo of the others.
    var bestLocalName: String? {
        for candidate in [areaOfInterest, locality, subLocality, administrativeArea, name] {
            if let candidate, !candidate.trimmingCharacters(in: .whitespaces).isEmpty {
                return candidate
            }
        }
        return nil
    }
}

/// One `MKLocalSearch` hit, flattened.
struct LocalSearchResult: Equatable {
    var name: String
    var category: String        // our POI category (see `PlaceEnrichment.poiCategory`)
    var coordinate: [Double]?   // [lng, lat]
    var elevation: Int?

    init(name: String, category: String = "landmark", coordinate: [Double]? = nil, elevation: Int? = nil) {
        self.name = name
        self.category = category
        self.coordinate = coordinate
        self.elevation = elevation
    }
}

// MARK: - Seams

/// Reverse-geocode a `[lng, lat]` to a flattened placemark, or nil when nothing resolves.
protocol ReverseGeocoding {
    func reverseGeocode(lng: Double, lat: Double) async throws -> GeocodedPlace?
}

/// Natural-language POI search around a coordinate.
protocol LocalPOISearching {
    func search(query: String, lng: Double, lat: Double, radiusMeters: Double) async throws -> [LocalSearchResult]
}

// MARK: - Inputs / outputs

/// One proposed day the enrichment reasons about — identity (so suggestions apply by id, not
/// position), current name (to honour the "auto-named only" rule), and median coordinate.
struct DayEnrichmentInput: Equatable {
    var dayID: String
    var name: String
    var coordinate: [Double]   // [lng, lat]; empty when the day has no geotagged data

    var hasCoordinate: Bool { coordinate.count >= 2 }
}

/// A camp-name suggestion tied to a day identity.
struct CampNameSuggestion: Equatable {
    var dayID: String
    var name: String
}

/// POI suggestions for a single day.
struct DayPOISuggestions: Equatable {
    var dayID: String
    var pois: [PointOfInterest]
}

// MARK: - Enrichment service

/// Composes the seams into the three enrichment products. Stateless apart from the injected
/// providers and the courtesy delay.
struct PlaceEnrichment {
    let geocoder: ReverseGeocoding
    let search: LocalPOISearching
    /// Serial courtesy delay between provider calls (nanoseconds). 0 in tests.
    let interCallDelayNanos: UInt64

    /// The natural-language POI queries run per day, each mapped to a POI category.
    static let poiQueries: [(query: String, category: String)] = [
        ("viewpoint", "viewpoint"),
        ("summit", "summit"),
        ("lake", "water"),
        ("mountain hut", "shelter"),
    ]

    /// Max POIs surfaced per day (kept small — these are accept-rows, not a directory).
    static let maxPOIsPerDay = 4

    init(geocoder: ReverseGeocoding, search: LocalPOISearching, interCallDelayNanos: UInt64 = 200_000_000) {
        self.geocoder = geocoder
        self.search = search
        self.interCallDelayNanos = interCallDelayNanos
    }

    // MARK: Country

    /// Suggest a country name from the journey centroid. Returns nil when nothing resolves.
    func suggestCountry(lng: Double, lat: Double) async -> String? {
        let place = try? await geocoder.reverseGeocode(lng: lng, lat: lat)
        let name = place?.countryName?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (name?.isEmpty == false) ? name : nil
    }

    /// Centroid of a set of `[lng, lat]` coordinates (mean), or nil when empty.
    static func centroid(of coordinates: [[Double]]) -> [Double]? {
        let valid = coordinates.filter { $0.count >= 2 }
        guard !valid.isEmpty else { return nil }
        let lng = valid.reduce(0) { $0 + $1[0] } / Double(valid.count)
        let lat = valid.reduce(0) { $0 + $1[1] } / Double(valid.count)
        return [lng, lat]
    }

    // MARK: Camp names

    /// Reverse-geocode a name for each day that (a) still carries an auto-generated placeholder and
    /// (b) has a coordinate. Days the user (or a GPX waypoint) already named are skipped entirely —
    /// no suggestion is produced for them. Serial, with the courtesy delay between calls.
    func suggestCampNames(for days: [DayEnrichmentInput]) async -> [CampNameSuggestion] {
        var out: [CampNameSuggestion] = []
        var first = true
        for day in days {
            guard DayNamer.isAutoGenerated(name: day.name), day.hasCoordinate else { continue }
            if !first { try? await Task.sleep(nanoseconds: interCallDelayNanos) }
            first = false
            guard let place = try? await geocoder.reverseGeocode(lng: day.coordinate[0], lat: day.coordinate[1]),
                  let name = place.bestLocalName?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !name.isEmpty
            else { continue }
            out.append(CampNameSuggestion(dayID: day.dayID, name: name))
        }
        return out
    }

    // MARK: POIs

    /// Search up to `maxPOIsPerDay` POIs around a day's coordinate, de-duplicated by name. Runs the
    /// `poiQueries` serially; each result becomes a `PointOfInterest` accept-row. Days without a
    /// coordinate yield nothing.
    func suggestPOIs(for day: DayEnrichmentInput, radiusMeters: Double = 3000) async -> DayPOISuggestions {
        guard day.hasCoordinate else { return DayPOISuggestions(dayID: day.dayID, pois: []) }
        var seen = Set<String>()
        var pois: [PointOfInterest] = []
        var first = true
        for spec in Self.poiQueries {
            if pois.count >= Self.maxPOIsPerDay { break }
            if !first { try? await Task.sleep(nanoseconds: interCallDelayNanos) }
            first = false
            let results = (try? await search.search(query: spec.query,
                                                    lng: day.coordinate[0], lat: day.coordinate[1],
                                                    radiusMeters: radiusMeters)) ?? []
            for result in results {
                let key = result.name.lowercased().trimmingCharacters(in: .whitespaces)
                guard !key.isEmpty, !seen.contains(key) else { continue }
                seen.insert(key)
                pois.append(PointOfInterest(
                    id: UUID().uuidString,
                    name: result.name,
                    category: result.category.isEmpty ? spec.category : result.category,
                    coordinates: result.coordinate,
                    elevation: result.elevation,
                    description: nil,
                    routeDistanceKm: nil,
                    tips: nil,
                    timeFromPrevious: nil,
                    icon: nil))
                if pois.count >= Self.maxPOIsPerDay { break }
            }
        }
        return DayPOISuggestions(dayID: day.dayID, pois: pois)
    }

    /// Convenience: build the enrichment over the real Apple providers (device / signed build).
    static func live() -> PlaceEnrichment {
        PlaceEnrichment(geocoder: SystemReverseGeocoder(), search: SystemLocalPOISearch())
    }
}

// MARK: - Live providers (CLGeocoder + MKLocalSearch)

#if canImport(CoreLocation)

/// `CLGeocoder`-backed reverse geocoder. One in-flight request at a time is enforced by the caller
/// (`PlaceEnrichment` is serial); `CLGeocoder` itself also rejects concurrent requests.
struct SystemReverseGeocoder: ReverseGeocoding {
    func reverseGeocode(lng: Double, lat: Double) async throws -> GeocodedPlace? {
        let location = CLLocation(latitude: lat, longitude: lng)
        let placemarks = try await CLGeocoder().reverseGeocodeLocation(location)
        guard let p = placemarks.first else { return nil }
        return GeocodedPlace(
            countryName: p.country,
            countryCode: p.isoCountryCode,
            locality: p.locality,
            subLocality: p.subLocality,
            administrativeArea: p.administrativeArea,
            areaOfInterest: p.areasOfInterest?.first,
            name: p.name)
    }
}

#else

/// Fallback when CoreLocation is unavailable at compile time (never on iOS; keeps `live()` total).
struct SystemReverseGeocoder: ReverseGeocoding {
    func reverseGeocode(lng: Double, lat: Double) async throws -> GeocodedPlace? { nil }
}

#endif

#if canImport(MapKit)

/// `MKLocalSearch`-backed POI search around a coordinate.
struct SystemLocalPOISearch: LocalPOISearching {
    func search(query: String, lng: Double, lat: Double, radiusMeters: Double) async throws -> [LocalSearchResult] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        let center = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        request.region = MKCoordinateRegion(center: center,
                                            latitudinalMeters: radiusMeters * 2,
                                            longitudinalMeters: radiusMeters * 2)
        if #available(iOS 13.0, *) {
            request.resultTypes = .pointOfInterest
        }
        let response = try await MKLocalSearch(request: request).start()
        return response.mapItems.compactMap { item in
            guard let name = item.name, !name.isEmpty else { return nil }
            let coord = item.placemark.coordinate
            return LocalSearchResult(
                name: name,
                category: Self.mapCategory(item.pointOfInterestCategory),
                coordinate: [coord.longitude, coord.latitude],
                elevation: nil)
        }
    }

    /// Map an `MKPointOfInterestCategory` to our compact POI category vocabulary.
    static func mapCategory(_ category: MKPointOfInterestCategory?) -> String {
        guard let category else { return "landmark" }
        switch category {
        case .nationalPark, .park: return "viewpoint"
        case .beach: return "water"
        case .campground: return "shelter"
        case .marina: return "water"
        default: return "landmark"
        }
    }
}

#else

struct SystemLocalPOISearch: LocalPOISearching {
    func search(query: String, lng: Double, lat: Double, radiusMeters: Double) async throws -> [LocalSearchResult] { [] }
}

#endif
